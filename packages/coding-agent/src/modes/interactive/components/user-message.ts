import {
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	TruncatedText,
	type ViewportInfo,
	type ViewportRenderResult,
} from "@mariozechner/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { applyStickyHeader } from "./sticky-header.js";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private collapsed = false;
	private contentContainer: Container;
	private headerMarker?: string;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);
		this.updateDisplay();
	}

	setCollapsed(collapsed: boolean): void {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		this.updateDisplay();
	}

	setHeaderMarker(marker?: string): void {
		if (this.headerMarker === marker) return;
		this.headerMarker = marker;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	renderViewport(width: number, viewport: ViewportInfo): ViewportRenderResult {
		const result = this.contentContainer.renderViewport(width, viewport);
		const lines = applyStickyHeader(result.lines, viewport.top, { headerIndex: 1, viewportHeight: viewport.height });
		return { lines, contentHeight: result.contentHeight };
	}

	private getPreviewText(): string {
		const trimmed = this.text.trim();
		if (!trimmed) return "";
		const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private updateDisplay(): void {
		this.contentContainer.clear();
		this.contentContainer.addChild(new Spacer(1));
		const marker = this.headerMarker ?? "";
		this.contentContainer.addChild(new TruncatedText(`${marker}${theme.fg("muted", theme.bold("User"))}`, 1, 0));

		if (this.collapsed) {
			const preview = this.getPreviewText();
			if (preview) {
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new TruncatedText(theme.fg("muted", preview), 1, 0));
			}
			return;
		}

		this.contentContainer.addChild(
			new Markdown(this.text, 1, 1, this.markdownTheme, {
				bgColor: (text: string) => theme.bg("userMessageBg", text),
				color: (text: string) => theme.fg("userMessageText", text),
			}),
		);
	}
}
