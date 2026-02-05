import * as os from "node:os";
import {
	Box,
	Container,
	getCapabilities,
	getImageDimensions,
	Image,
	imageFallback,
	Spacer,
	Text,
	TruncatedText,
	type TUI,
	truncateToWidth,
	type ViewportInfo,
	type ViewportRenderResult,
} from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import type { ToolDefinition } from "../../../core/extensions/types.js";
import { computeEditDiff, type EditDiffError, type EditDiffResult } from "../../../core/tools/edit-diff.js";
import { allTools } from "../../../core/tools/index.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "../../../core/tools/truncate.js";
import {
	applyOutputFilter,
	type BlockOutputFilter,
	type BlockOutputFilterResult,
	formatOutputFilterLabel,
	normalizeOutputFilter,
} from "../../../utils/block-output-filter.js";
import { convertToPng } from "../../../utils/image-convert.js";
import { sanitizeBinaryOutput } from "../../../utils/shell.js";
import { getLanguageFromPath, highlightCode, theme } from "../theme/theme.js";
import { renderDiff } from "./diff.js";
import { keyHint } from "./keybinding-hints.js";
import { applyStickyHeader } from "./sticky-header.js";
import { truncateToVisualLines } from "./visual-truncate.js";

// Preview line limit for bash when not expanded
const BASH_PREVIEW_LINES = 5;

/**
 * Convert absolute path to tilde notation if it's in home directory
 */
function shortenPath(path: string): string {
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/**
 * Replace tabs with spaces for consistent rendering
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export interface ToolExecutionOptions {
	showImages?: boolean; // default: true (only used if terminal supports images)
	step?: number;
}

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private contentBox: Box; // Used for custom tools and bash visual truncation
	private contentText: Text; // For built-in tools (with its own padding/bg)
	private stepContainer: Container;
	private stepBox: Box;
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private args: any;
	private step?: number;
	private expanded = false;
	private headerMarker?: string;
	private headerBadge?: string;
	private outputFilter?: BlockOutputFilter;
	private outputFilterCache?: {
		outputVersion: number;
		filterKey: string;
		result: BlockOutputFilterResult | null;
	};
	private outputVersion = 0;
	private outputStatsCache?: {
		outputVersion: number;
		stats: { byteCount: number; lineCount: number; lastLine?: string };
	};
	private showImages: boolean;
	private isPartial = true;
	private toolDefinition?: ToolDefinition;
	private ui: TUI;
	private cwd: string;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	// Cached edit diff preview (computed when args arrive, before tool executes)
	private editDiffPreview?: EditDiffResult | EditDiffError;
	private editDiffArgsKey?: string; // Track which args the preview is for
	// Cached converted images for Kitty protocol (which requires PNG), keyed by index
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();

	constructor(
		toolName: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolDefinition | undefined,
		ui: TUI,
		cwd: string = process.cwd(),
	) {
		super();
		this.toolName = toolName;
		this.args = args;
		this.step = options.step;
		this.showImages = options.showImages ?? true;
		this.toolDefinition = toolDefinition;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		this.stepContainer = new Container();
		this.stepBox = new Box(1, 0, (text: string) => theme.bg("toolPendingBg", text));
		this.addChild(this.stepContainer);

		// Always create both - contentBox for custom tools/bash, contentText for other built-ins
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));

		// Use contentBox for bash (visual truncation) or custom tools with custom renderers
		// Use contentText for built-in tools (including overrides without custom renderers)
		if (toolName === "bash" || (toolDefinition && !this.shouldUseBuiltInRenderer())) {
			this.addChild(this.contentBox);
		} else {
			this.addChild(this.contentText);
		}

		this.updateDisplay();
	}

	/**
	 * Check if we should use built-in rendering for this tool.
	 * Returns true if the tool name is a built-in AND either there's no toolDefinition
	 * or the toolDefinition doesn't provide custom renderers.
	 */
	private shouldUseBuiltInRenderer(): boolean {
		const isBuiltInName = this.toolName in allTools;
		const hasCustomRenderers = this.toolDefinition?.renderCall || this.toolDefinition?.renderResult;
		return isBuiltInName && !hasCustomRenderers;
	}

	updateArgs(args: any): void {
		this.args = args;
		this.outputVersion += 1;
		this.outputFilterCache = undefined;
		this.outputStatsCache = undefined;
		this.updateDisplay();
	}

	/**
	 * Signal that args are complete (tool is about to execute).
	 * This triggers diff computation for edit tool.
	 */
	setArgsComplete(): void {
		this.maybeComputeEditDiff();
	}

	/**
	 * Compute edit diff preview when we have complete args.
	 * This runs async and updates display when done.
	 */
	private maybeComputeEditDiff(): void {
		if (this.toolName !== "edit") return;

		const path = this.args?.path;
		const oldText = this.args?.oldText;
		const newText = this.args?.newText;

		// Need all three params to compute diff
		if (!path || oldText === undefined || newText === undefined) return;

		// Create a key to track which args this computation is for
		const argsKey = JSON.stringify({ path, oldText, newText });

		// Skip if we already computed for these exact args
		if (this.editDiffArgsKey === argsKey) return;

		this.editDiffArgsKey = argsKey;

		// Compute diff async
		computeEditDiff(path, oldText, newText, this.cwd).then((result) => {
			// Only update if args haven't changed since we started
			if (this.editDiffArgsKey === argsKey) {
				this.editDiffPreview = result;
				this.updateDisplay();
				this.ui.requestRender();
			}
		});
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.outputVersion += 1;
		this.outputFilterCache = undefined;
		this.outputStatsCache = undefined;
		this.updateDisplay();
		// Convert non-PNG images to PNG for Kitty protocol (async)
		this.maybeConvertImagesForKitty();
	}

	/**
	 * Convert non-PNG images to PNG for Kitty graphics protocol.
	 * Kitty requires PNG format (f=100), so JPEG/GIF/WebP won't display.
	 */
	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		// Only needed for Kitty protocol
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];

		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			// Skip if already PNG or already converted
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			// Convert async
			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
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
		return this.shouldUseBuiltInRenderer() && this.toolName !== "edit";
	}

	getBlockText(): string {
		const sections: string[] = [];
		sections.push(this.toolName);
		if (this.args !== undefined) {
			try {
				sections.push(JSON.stringify(this.args, null, 2));
			} catch {
				// ignore arg serialization errors
			}
		}
		const output = this.getTextOutput();
		if (output) {
			sections.push(output);
		}
		return sections.join("\n");
	}

	getOutputStats(): { byteCount: number; lineCount: number; lastLine?: string } {
		if (this.outputStatsCache && this.outputStatsCache.outputVersion === this.outputVersion) {
			return this.outputStatsCache.stats;
		}
		const output = this.getTextOutput();
		const lines = output ? output.split("\n") : [];
		const stats = {
			byteCount: output ? Buffer.byteLength(output, "utf8") : 0,
			lineCount: lines.length,
			lastLine: lines.length > 0 ? lines[lines.length - 1] : undefined,
		};
		this.outputStatsCache = { outputVersion: this.outputVersion, stats };
		return stats;
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	renderViewport(width: number, viewport: ViewportInfo): ViewportRenderResult {
		const result = super.renderViewport(width, viewport);
		const lines = applyStickyHeader(result.lines, viewport.top, { scanLimit: 24, viewportHeight: viewport.height });
		return { lines, contentHeight: result.contentHeight };
	}

	private getHeaderPrefix(): string {
		return `${this.headerMarker ?? ""}${this.headerBadge ?? ""}`;
	}

	private getFilterHeaderSuffix(): string {
		if (!this.outputFilter || !this.supportsOutputFilter()) return "";
		if (!this.outputFilter.query.trim()) return "";
		const label = formatOutputFilterLabel(this.outputFilter);
		return theme.fg("muted", ` [filter: ${label}]`);
	}

	private getOutputFilterResult(rawLines: string[], displayLines: string[]): BlockOutputFilterResult | null {
		if (!this.outputFilter || !this.supportsOutputFilter()) return null;
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
		// Set background based on state
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		this.stepContainer.clear();
		if (this.step !== undefined) {
			this.stepBox.setBgFn(bgFn);
			this.stepBox.clear();
			this.stepBox.addChild(new TruncatedText(this.formatStepCardText(), 0, 0));
			this.stepContainer.addChild(this.stepBox);
		}

		// Use built-in rendering for built-in tools (or overrides without custom renderers)
		if (this.shouldUseBuiltInRenderer()) {
			if (this.toolName === "bash") {
				// Bash uses Box with visual line truncation
				this.contentBox.setBgFn(bgFn);
				this.contentBox.clear();
				this.renderBashContent();
			} else {
				// Other built-in tools: use Text directly with caching
				this.contentText.setCustomBgFn(bgFn);
				this.contentText.setText(this.formatToolExecution());
			}
		} else if (this.toolDefinition) {
			// Custom tools use Box for flexible component rendering
			this.contentBox.setBgFn(bgFn);
			this.contentBox.clear();

			// Render call component
			if (this.toolDefinition.renderCall) {
				try {
					const callComponent = this.toolDefinition.renderCall(this.args, theme);
					if (callComponent) {
						this.contentBox.addChild(callComponent);
					}
				} catch {
					// Fall back to default on error
					this.contentBox.addChild(new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0));
				}
			} else {
				// No custom renderCall, show tool name
				this.contentBox.addChild(new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0));
			}

			// Render result component if we have a result
			if (this.result && this.toolDefinition.renderResult) {
				try {
					const resultComponent = this.toolDefinition.renderResult(
						{ content: this.result.content as any, details: this.result.details },
						{ expanded: this.expanded, isPartial: this.isPartial },
						theme,
					);
					if (resultComponent) {
						this.contentBox.addChild(resultComponent);
					}
				} catch {
					// Fall back to showing raw output on error
					const output = this.getTextOutput();
					if (output) {
						this.contentBox.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
					}
				}
			} else if (this.result) {
				// Has result but no custom renderResult
				const output = this.getTextOutput();
				if (output) {
					this.contentBox.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
				}
			}
		}

		// Handle images (same for both custom and built-in)
		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];
			const caps = getCapabilities();
			const canRenderImages = !!caps.images && this.showImages && this.expanded;

			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (canRenderImages && img.data && img.mimeType) {
					// Use converted PNG for Kitty protocol if available
					const converted = this.convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;

					// For Kitty, skip non-PNG images that haven't been converted yet
					if (caps.images === "kitty" && imageMimeType !== "image/png") {
						continue;
					}

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: 60 },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}
	}

	private getStepHeaderMarker(): string {
		return this.step !== undefined ? this.getHeaderPrefix() : "";
	}

	private getToolHeaderMarker(): string {
		return this.step === undefined ? this.getHeaderPrefix() : "";
	}

	private formatStepCardText(): string {
		if (this.step === undefined) return "";
		const summary = this.formatStepSummary();
		const marker = this.getStepHeaderMarker();
		return `${marker}${theme.fg("muted", `Step ${this.step}`)}${theme.fg("muted", " • ")}${summary}`;
	}

	private formatStepSummary(): string {
		if (this.toolName === "read") {
			const rawPath = this.args?.file_path || this.args?.path || "";
			const path = rawPath ? shortenPath(String(rawPath)) : "";
			const offset = this.args?.offset as number | undefined;
			const limit = this.args?.limit as number | undefined;

			let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}

			return `${theme.fg("toolTitle", "Read")} ${pathDisplay}`;
		}

		if (this.toolName === "write") {
			const rawPath = this.args?.file_path || this.args?.path || "";
			const path = rawPath ? shortenPath(String(rawPath)) : "";
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			return `${theme.fg("toolTitle", "Write")} ${pathDisplay}`;
		}

		if (this.toolName === "edit") {
			const rawPath = this.args?.file_path || this.args?.path || "";
			const path = rawPath ? shortenPath(String(rawPath)) : "";
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			return `${theme.fg("toolTitle", "Edit")} ${pathDisplay}`;
		}

		if (this.toolName === "bash") {
			const rawCommand = String(this.args?.command || "")
				.replace(/\s+/g, " ")
				.trim();
			const command = rawCommand.length > 60 ? `${rawCommand.slice(0, 57)}...` : rawCommand;
			return `${theme.fg("toolTitle", "Run")} ${theme.fg("toolOutput", command || "...")}`;
		}

		if (this.toolName === "ls") {
			const path = shortenPath(String(this.args?.path || "."));
			return `${theme.fg("toolTitle", "List")} ${theme.fg("accent", path)}`;
		}

		if (this.toolName === "find") {
			const pattern = String(this.args?.pattern || "");
			const path = shortenPath(String(this.args?.path || "."));
			const patternText = pattern ? theme.fg("accent", pattern) : theme.fg("toolOutput", "...");
			return `${theme.fg("toolTitle", "Find")} ${patternText} ${theme.fg("muted", "in")} ${theme.fg("accent", path)}`;
		}

		if (this.toolName === "grep") {
			const pattern = String(this.args?.pattern || "");
			const path = shortenPath(String(this.args?.path || "."));
			const patternText = pattern ? theme.fg("accent", `/${pattern}/`) : theme.fg("toolOutput", "...");
			return `${theme.fg("toolTitle", "Grep")} ${patternText} ${theme.fg("muted", "in")} ${theme.fg("accent", path)}`;
		}

		const toolLabel = theme.fg("toolTitle", this.toolName);
		return `${theme.fg("toolTitle", "Run")} ${toolLabel}`;
	}

	/**
	 * Render bash content using visual line truncation (like bash-execution.ts)
	 */
	private renderBashContent(): void {
		const command = this.args?.command || "";
		const timeout = this.args?.timeout as number | undefined;

		// Header
		const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
		const headerMarker = this.getToolHeaderMarker();
		const filterSuffix = this.getFilterHeaderSuffix();
		this.contentBox.addChild(
			new Text(
				`${headerMarker}${theme.fg("toolTitle", theme.bold(`$ ${command || theme.fg("toolOutput", "...")}`))}${timeoutSuffix}${filterSuffix}`,
				0,
				0,
			),
		);

		if (this.result) {
			const output = this.getTextOutput().trim();

			if (output) {
				const rawLines = output.split("\n");
				const styledLines = rawLines.map((line) => theme.fg("toolOutput", line));
				const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, styledLines);
				const styledOutput = filteredLines.join("\n");

				if (this.expanded) {
					// Show all lines when expanded
					this.contentBox.addChild(new Text(`\n${styledOutput}`, 0, 0));
					if (hint) {
						this.contentBox.addChild(new Text(`\n${hint}`, 0, 0));
					}
				} else {
					// Use visual line truncation when collapsed with width-aware caching
					let cachedWidth: number | undefined;
					let cachedLines: string[] | undefined;
					let cachedSkipped: number | undefined;

					this.contentBox.addChild({
						render: (width: number) => {
							if (cachedLines === undefined || cachedWidth !== width) {
								const result = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
								cachedLines = result.visualLines;
								cachedSkipped = result.skippedCount;
								cachedWidth = width;
							}
							const lines: string[] = [];
							if (cachedSkipped && cachedSkipped > 0) {
								const skippedHint =
									theme.fg("muted", `... (${cachedSkipped} earlier lines,`) +
									` ${keyHint("expandTools", "to expand")})`;
								lines.push("", truncateToWidth(skippedHint, width, "..."));
							} else {
								lines.push("");
							}
							if (cachedLines && cachedLines.length > 0) {
								lines.push(...cachedLines);
							}
							if (hint) {
								lines.push(truncateToWidth(hint, width, "..."));
							}
							return lines;
						},
						invalidate: () => {
							cachedWidth = undefined;
							cachedLines = undefined;
							cachedSkipped = undefined;
						},
					});
				}
			}

			// Truncation warnings
			const truncation = this.result.details?.truncation;
			const fullOutputPath = this.result.details?.fullOutputPath;
			if (truncation?.truncated || fullOutputPath) {
				const warnings: string[] = [];
				if (fullOutputPath) {
					warnings.push(`Full output: ${fullOutputPath}`);
				}
				if (truncation?.truncated) {
					if (truncation.truncatedBy === "lines") {
						warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
					} else {
						warnings.push(
							`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
						);
					}
				}
				this.contentBox.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
			}
		}
	}

	private getTextOutput(): string {
		if (!this.result) return "";

		const textBlocks = this.result.content?.filter((c: any) => c.type === "text") || [];
		const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];

		let output = textBlocks
			.map((c: any) => {
				// Use sanitizeBinaryOutput to handle binary data that crashes string-width
				return sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "");
			})
			.join("\n");

		const caps = getCapabilities();
		const canRenderImages = !!caps.images && this.showImages && this.expanded;
		if (imageBlocks.length > 0 && !canRenderImages) {
			const imageIndicators = imageBlocks
				.map((img: any) => {
					const dims = img.data ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
					return imageFallback(img.mimeType, dims);
				})
				.join("\n");
			output = output ? `${output}\n${imageIndicators}` : imageIndicators;
		}

		return output;
	}

	private formatToolExecution(): string {
		let text = "";
		const headerMarker = this.getToolHeaderMarker();
		const filterSuffix = this.getFilterHeaderSuffix();

		if (this.toolName === "read") {
			const path = shortenPath(this.args?.file_path || this.args?.path || "");
			const offset = this.args?.offset;
			const limit = this.args?.limit;

			let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}

			text = `${headerMarker}${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${filterSuffix}`;

			if (this.result) {
				const output = this.getTextOutput();
				const rawPath = this.args?.file_path || this.args?.path || "";
				const lang = getLanguageFromPath(rawPath);
				const rawOutput = replaceTabs(output);
				const rawLines = rawOutput.split("\n");
				const displayLines = lang ? highlightCode(rawOutput, lang) : rawLines;
				const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, displayLines);

				const maxLines = this.expanded ? filteredLines.length : 10;
				const visibleLines = filteredLines.slice(0, maxLines);
				const remaining = filteredLines.length - maxLines;
				const styledLines = lang
					? visibleLines.map((line: string) => replaceTabs(line))
					: visibleLines.map((line: string) => theme.fg("toolOutput", replaceTabs(line)));

				text += `\n\n${styledLines.join("\n")}`;
				if (remaining > 0) {
					text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
				}
				if (hint) {
					text += `\n${hint}`;
				}

				const truncation = this.result.details?.truncation;
				if (truncation?.truncated) {
					if (truncation.firstLineExceedsLimit) {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`,
							);
					} else if (truncation.truncatedBy === "lines") {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`,
							);
					} else {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`,
							);
					}
				}
			}
		} else if (this.toolName === "write") {
			const rawPath = this.args?.file_path || this.args?.path || "";
			const path = shortenPath(rawPath);
			const fileContent = this.args?.content || "";
			const lang = getLanguageFromPath(rawPath);
			const rawOutput = replaceTabs(fileContent);
			const rawLines = fileContent ? rawOutput.split("\n") : [];
			const displayLines = fileContent ? (lang ? highlightCode(rawOutput, lang) : rawLines) : [];
			const {
				lines: filteredLines,
				hint,
				result: filterResult,
			} = this.applyOutputFilterToLines(rawLines, displayLines);
			const totalLines = filterResult?.totalLines ?? filteredLines.length;

			text =
				headerMarker +
				theme.fg("toolTitle", theme.bold("write")) +
				" " +
				(path ? theme.fg("accent", path) : theme.fg("toolOutput", "...")) +
				filterSuffix;

			if (fileContent) {
				const maxLines = this.expanded ? filteredLines.length : 10;
				const visibleLines = filteredLines.slice(0, maxLines);
				const remaining = filteredLines.length - maxLines;
				const styledLines = lang
					? visibleLines.map((line: string) => replaceTabs(line))
					: visibleLines.map((line: string) => theme.fg("toolOutput", replaceTabs(line)));

				text += `\n\n${styledLines.join("\n")}`;
				if (remaining > 0) {
					text +=
						theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`) +
						` ${keyHint("expandTools", "to expand")})`;
				}
				if (hint) {
					text += `\n${hint}`;
				}
			}

			// Show error if tool execution failed
			if (this.result?.isError) {
				const errorText = this.getTextOutput();
				if (errorText) {
					text += `\n\n${theme.fg("error", errorText)}`;
				}
			}
		} else if (this.toolName === "edit") {
			const rawPath = this.args?.file_path || this.args?.path || "";
			const path = shortenPath(rawPath);

			// Build path display, appending :line if we have diff info
			let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const firstChangedLine =
				(this.editDiffPreview && "firstChangedLine" in this.editDiffPreview
					? this.editDiffPreview.firstChangedLine
					: undefined) ||
				(this.result && !this.result.isError ? this.result.details?.firstChangedLine : undefined);
			if (firstChangedLine) {
				pathDisplay += theme.fg("warning", `:${firstChangedLine}`);
			}

			text = `${headerMarker}${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}${filterSuffix}`;

			if (this.result?.isError) {
				// Show error from result
				const errorText = this.getTextOutput();
				if (errorText) {
					text += `\n\n${theme.fg("error", errorText)}`;
				}
			} else if (this.result?.details?.diff) {
				// Tool executed successfully - use the diff from result
				// This takes priority over editDiffPreview which may have a stale error
				// due to race condition (async preview computed after file was modified)
				text += `\n\n${renderDiff(this.result.details.diff, { filePath: rawPath })}`;
			} else if (this.editDiffPreview) {
				// Use cached diff preview (before tool executes)
				if ("error" in this.editDiffPreview) {
					text += `\n\n${theme.fg("error", this.editDiffPreview.error)}`;
				} else if (this.editDiffPreview.diff) {
					text += `\n\n${renderDiff(this.editDiffPreview.diff, { filePath: rawPath })}`;
				}
			}
		} else if (this.toolName === "ls") {
			const path = shortenPath(this.args?.path || ".");
			const limit = this.args?.limit;

			text = `${headerMarker}${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` (limit ${limit})`);
			}
			text += filterSuffix;

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const rawLines = output.split("\n");
					const styledLines = rawLines.map((line) => theme.fg("toolOutput", line));
					const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, styledLines);
					const maxLines = this.expanded ? filteredLines.length : 20;
					const visibleLines = filteredLines.slice(0, maxLines);
					const remaining = filteredLines.length - maxLines;

					text += `\n\n${visibleLines.join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
					if (hint) {
						text += `\n${hint}`;
					}
				}

				const entryLimit = this.result.details?.entryLimitReached;
				const truncation = this.result.details?.truncation;
				if (entryLimit || truncation?.truncated) {
					const warnings: string[] = [];
					if (entryLimit) {
						warnings.push(`${entryLimit} entries limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else if (this.toolName === "find") {
			const pattern = this.args?.pattern || "";
			const path = shortenPath(this.args?.path || ".");
			const limit = this.args?.limit;

			text =
				headerMarker +
				theme.fg("toolTitle", theme.bold("find")) +
				" " +
				theme.fg("accent", pattern) +
				theme.fg("toolOutput", ` in ${path}`);
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` (limit ${limit})`);
			}
			text += filterSuffix;

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const rawLines = output.split("\n");
					const styledLines = rawLines.map((line) => theme.fg("toolOutput", line));
					const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, styledLines);
					const maxLines = this.expanded ? filteredLines.length : 20;
					const visibleLines = filteredLines.slice(0, maxLines);
					const remaining = filteredLines.length - maxLines;

					text += `\n\n${visibleLines.join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
					if (hint) {
						text += `\n${hint}`;
					}
				}

				const resultLimit = this.result.details?.resultLimitReached;
				const truncation = this.result.details?.truncation;
				if (resultLimit || truncation?.truncated) {
					const warnings: string[] = [];
					if (resultLimit) {
						warnings.push(`${resultLimit} results limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else if (this.toolName === "grep") {
			const pattern = this.args?.pattern || "";
			const path = shortenPath(this.args?.path || ".");
			const glob = this.args?.glob;
			const limit = this.args?.limit;

			text =
				headerMarker +
				theme.fg("toolTitle", theme.bold("grep")) +
				" " +
				theme.fg("accent", `/${pattern}/`) +
				theme.fg("toolOutput", ` in ${path}`);
			if (glob) {
				text += theme.fg("toolOutput", ` (${glob})`);
			}
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` limit ${limit}`);
			}
			text += filterSuffix;

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const rawLines = output.split("\n");
					const styledLines = rawLines.map((line) => theme.fg("toolOutput", line));
					const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, styledLines);
					const maxLines = this.expanded ? filteredLines.length : 15;
					const visibleLines = filteredLines.slice(0, maxLines);
					const remaining = filteredLines.length - maxLines;

					text += `\n\n${visibleLines.join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
					if (hint) {
						text += `\n${hint}`;
					}
				}

				const matchLimit = this.result.details?.matchLimitReached;
				const truncation = this.result.details?.truncation;
				const linesTruncated = this.result.details?.linesTruncated;
				if (matchLimit || truncation?.truncated || linesTruncated) {
					const warnings: string[] = [];
					if (matchLimit) {
						warnings.push(`${matchLimit} matches limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					if (linesTruncated) {
						warnings.push("some lines truncated");
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else {
			// Generic tool (shouldn't reach here for custom tools)
			text = `${headerMarker}${theme.fg("toolTitle", theme.bold(this.toolName))}${filterSuffix}`;

			const content = JSON.stringify(this.args, null, 2);
			text += `\n\n${content}`;
			const output = this.getTextOutput();
			if (output) {
				const rawLines = output.split("\n");
				const styledLines = rawLines.map((line) => theme.fg("toolOutput", line));
				const { lines: filteredLines, hint } = this.applyOutputFilterToLines(rawLines, styledLines);
				text += `\n${filteredLines.join("\n")}`;
				if (hint) {
					text += `\n${hint}`;
				}
			}
		}

		return text;
	}
}
