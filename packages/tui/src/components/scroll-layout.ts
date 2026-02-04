import { type Component, isViewportAware, type ViewportInfo, type ViewportRenderResult } from "../tui.js";

export type ScrollLayoutOptions = {
	scrollEnabled?: boolean;
	followOutput?: boolean;
};

/**
 * Layout component that keeps a fixed bottom region while allowing the top
 * region to scroll independently.
 */
export class ScrollLayout implements Component {
	private scrollEnabled: boolean;
	private followOutput: boolean;
	private scrollTop = 0;
	private lastAvailableHeight = 0;
	private lastContentHeight = 0;
	private lastViewportHeight = 0;

	constructor(
		private scrollable: Component,
		private fixed: Component,
		options: ScrollLayoutOptions = {},
	) {
		this.scrollEnabled = options.scrollEnabled ?? true;
		this.followOutput = options.followOutput ?? true;
	}

	invalidate(): void {
		this.scrollable.invalidate?.();
		this.fixed.invalidate?.();
	}

	setScrollEnabled(enabled: boolean): void {
		this.scrollEnabled = enabled;
		if (!enabled) {
			this.scrollTop = 0;
			this.followOutput = true;
		}
	}

	getScrollEnabled(): boolean {
		return this.scrollEnabled;
	}

	scrollBy(lines: number): void {
		if (!this.scrollEnabled) return;
		this.setScrollTop(this.scrollTop + lines);
	}

	scrollToTop(): void {
		if (!this.scrollEnabled) return;
		this.followOutput = false;
		this.setScrollTop(0);
	}

	scrollToBottom(): void {
		if (!this.scrollEnabled) {
			this.scrollTop = 0;
			this.followOutput = true;
			return;
		}
		this.followOutput = true;
		this.scrollTop = this.getMaxScrollTop();
	}

	getScrollTop(): number {
		return this.scrollTop;
	}

	getMaxScrollTop(): number {
		return Math.max(0, this.lastContentHeight - this.lastAvailableHeight);
	}

	isAtBottom(): boolean {
		return this.scrollTop >= this.getMaxScrollTop();
	}

	private setScrollTop(top: number): void {
		const maxScrollTop = this.getMaxScrollTop();
		const clamped = Math.max(0, Math.min(top, maxScrollTop));
		this.scrollTop = clamped;
		this.followOutput = clamped >= maxScrollTop;
	}

	renderViewport(width: number, viewport: ViewportInfo): ViewportRenderResult {
		const viewportHeight = Math.max(0, viewport.height);
		const fullFixedLines = this.fixed.render(width);
		const fixedHeight = fullFixedLines.length;

		let fixedLines = fullFixedLines;
		if (this.scrollEnabled && fixedLines.length > viewportHeight) {
			fixedLines = fixedLines.slice(fixedLines.length - viewportHeight);
		}

		const fixedVisibleHeight = fixedLines.length;
		const availableHeight = Math.max(0, viewportHeight - fixedVisibleHeight);

		const renderHeight = this.scrollEnabled ? availableHeight : viewport.height;
		const renderTop = this.scrollEnabled ? this.scrollTop : viewport.top;

		let outputLines: string[] = [];
		let outputContentHeight = 0;

		if (isViewportAware(this.scrollable)) {
			const result = this.scrollable.renderViewport(width, {
				width,
				height: renderHeight,
				top: renderTop,
			});
			outputLines = result.lines;
			outputContentHeight = Math.max(result.contentHeight, outputLines.length);
		} else {
			outputLines = this.scrollable.render(width);
			outputContentHeight = outputLines.length;
		}

		const maxScrollTop = Math.max(0, outputContentHeight - availableHeight);
		let nextScrollTop = 0;
		if (this.scrollEnabled) {
			nextScrollTop = this.followOutput ? maxScrollTop : Math.min(this.scrollTop, maxScrollTop);
		}

		if (this.scrollEnabled && nextScrollTop !== this.scrollTop) {
			this.scrollTop = nextScrollTop;
			if (isViewportAware(this.scrollable)) {
				const rerendered = this.scrollable.renderViewport(width, {
					width,
					height: availableHeight,
					top: nextScrollTop,
				});
				outputLines = rerendered.lines;
				outputContentHeight = Math.max(rerendered.contentHeight, outputLines.length);
			}
		} else if (this.scrollEnabled) {
			this.scrollTop = nextScrollTop;
		}

		if (this.scrollEnabled) {
			const outputIsFull = outputLines.length >= outputContentHeight;
			if (outputIsFull) {
				outputLines = outputLines.slice(this.scrollTop, this.scrollTop + availableHeight);
			}
			if (outputLines.length < availableHeight) {
				outputLines = outputLines.concat(Array(availableHeight - outputLines.length).fill(""));
			}
		}

		this.lastAvailableHeight = availableHeight;
		this.lastContentHeight = outputContentHeight;
		this.lastViewportHeight = viewportHeight;
		if (this.scrollEnabled) {
			this.followOutput = this.scrollTop >= maxScrollTop;
		} else {
			this.followOutput = true;
		}

		const lines = this.scrollEnabled ? [...outputLines, ...fixedLines] : [...outputLines, ...fullFixedLines];

		return {
			lines,
			contentHeight: outputContentHeight + fixedHeight,
		};
	}

	render(width: number): string[] {
		if (this.lastViewportHeight > 0) {
			return this.renderViewport(width, { width, height: this.lastViewportHeight, top: 0 }).lines;
		}

		const scrollableLines = isViewportAware(this.scrollable)
			? this.scrollable.renderViewport(width, { width, height: Number.MAX_SAFE_INTEGER, top: 0 }).lines
			: this.scrollable.render(width);
		const fixedLines = this.fixed.render(width);
		return [...scrollableLines, ...fixedLines];
	}
}
