import type { AssistantMessage, TextContent, ThinkingContent } from "@mariozechner/pi-ai";
import {
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
	TruncatedText,
	type ViewportInfo,
	type ViewportRenderResult,
} from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { applyStickyHeader } from "./sticky-header.js";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private lastMessage?: AssistantMessage;
	private collapsed = false;
	private headerMarker?: string;
	private headerBadge?: string;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	renderViewport(width: number, viewport: ViewportInfo): ViewportRenderResult {
		const result = this.contentContainer.renderViewport(width, viewport);
		const lines = applyStickyHeader(result.lines, viewport.top, { headerIndex: 1, viewportHeight: viewport.height });
		return { lines, contentHeight: result.contentHeight };
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
	}

	setHeaderMarker(marker?: string): void {
		if (this.headerMarker === marker) return;
		this.headerMarker = marker;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHeaderBadge(badge?: string): void {
		if (this.headerBadge === badge) return;
		this.headerBadge = badge;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setCollapsed(collapsed: boolean): void {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	private getHeaderText(message: AssistantMessage): string {
		const label = theme.fg("muted", theme.bold("Assistant"));
		const model = message.model ? theme.fg("dim", ` • ${message.model}`) : "";
		const marker = this.headerMarker ?? "";
		const badge = this.headerBadge ?? "";
		return `${marker}${badge}${label}${model}`;
	}

	private formatPreviewText(text: string): string {
		const trimmed = text.trim();
		if (!trimmed) return "";
		const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private getPreviewText(message: AssistantMessage): string {
		const textContent = message.content.find((c): c is TextContent => c.type === "text" && c.text.trim().length > 0);
		if (textContent) {
			return this.formatPreviewText(textContent.text);
		}

		const thinkingContent = message.content.find(
			(c): c is ThinkingContent => c.type === "thinking" && c.thinking.trim().length > 0,
		);
		if (thinkingContent) {
			return this.hideThinkingBlock ? "Thinking..." : this.formatPreviewText(thinkingContent.thinking);
		}

		const toolCalls = message.content.filter((c) => c.type === "toolCall").length;
		if (toolCalls > 0) {
			return toolCalls === 1 ? "Tool call" : `${toolCalls} tool calls`;
		}

		return "";
	}

	private getStopErrorMessage(message: AssistantMessage): string | undefined {
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		if (hasToolCalls) return undefined;

		if (message.stopReason === "aborted") {
			return message.errorMessage && message.errorMessage !== "Request was aborted"
				? message.errorMessage
				: "Operation aborted";
		}

		if (message.stopReason === "error") {
			const errorMsg = message.errorMessage || "Unknown error";
			return `Error: ${errorMsg}`;
		}

		return undefined;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		this.contentContainer.addChild(new Spacer(1));
		this.contentContainer.addChild(new TruncatedText(this.getHeaderText(message), 1, 0));

		const errorMessage = this.getStopErrorMessage(message);

		if (this.collapsed) {
			const previewText = this.getPreviewText(message);
			if (previewText || errorMessage) {
				this.contentContainer.addChild(new Spacer(1));
			}
			if (previewText) {
				this.contentContainer.addChild(new TruncatedText(theme.fg("muted", previewText), 1, 0));
			}
			if (errorMessage) {
				this.contentContainer.addChild(new Text(theme.fg("error", errorMessage), 1, 0));
			}
			return;
		}

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(new Markdown(content.text.trim(), 1, 0, this.markdownTheme));
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Check if there's text content after this thinking block
				const hasTextAfter = message.content.slice(i + 1).some((c) => c.type === "text" && c.text.trim());

				if (this.hideThinkingBlock) {
					// Show static "Thinking..." label when hidden
					this.contentContainer.addChild(new Text(theme.italic(theme.fg("thinkingText", "Thinking...")), 1, 0));
					if (hasTextAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), 1, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		if (errorMessage) {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(new Text(theme.fg("error", errorMessage), 1, 0));
		}
	}
}
