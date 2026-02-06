/**
 * Vim Mode - Full vim-like modal editing for pi
 *
 * Usage: pi --extension ./examples/extensions/vim-mode.ts
 *
 * Modes:
 *   - Insert: Normal text editing (start here)
 *   - Normal: Navigation and commands
 *   - Visual: Character-wise selection
 *   - Visual Line: Line-wise selection
 *
 * Mode switching:
 *   - Escape: insert/visual → normal (in normal mode, passes to app for abort)
 *   - i: insert before cursor
 *   - a: insert after cursor
 *   - A: insert at end of line
 *   - I: insert at start of line
 *   - o: open line below
 *   - O: open line above
 *   - v: visual mode
 *   - V: visual line mode
 *
 * Motions (normal & visual):
 *   - h/j/k/l: left/down/up/right
 *   - w: word forward
 *   - b: word backward
 *   - e: end of word
 *   - 0: line start
 *   - $: line end
 *   - ^: first non-whitespace
 *   - gg: document start
 *   - G: document end
 *
 * Operators (normal mode, can combine with motions):
 *   - d: delete (dd = delete line, dw = delete word, etc.)
 *   - c: change (delete and enter insert mode)
 *   - y: yank (copy)
 *
 * Other commands:
 *   - x: delete char under cursor
 *   - X: delete char before cursor
 *   - p: paste after cursor
 *   - P: paste before cursor
 *   - u: undo
 *   - r<char>: replace char under cursor
 *
 * Counts:
 *   - Prefix motions/operators with numbers: 3j, 2dw, 5x
 */

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type Mode = "normal" | "insert" | "visual" | "visual-line";
type Operator = "d" | "c" | "y" | null;

interface Position {
	line: number;
	col: number;
}

class VimEditor extends CustomEditor {
	private mode: Mode = "insert";
	private operator: Operator = null;
	private count: number = 0;
	private register: string = ""; // Yank register
	private visualAnchor: Position | null = null;
	private pendingG: boolean = false; // For gg command
	private pendingR: boolean = false; // For r<char> replace
	private statusMessage: string = "";

	private getCount(): number {
		return this.count || 1;
	}

	private resetState(): void {
		this.operator = null;
		this.count = 0;
		this.pendingG = false;
		this.pendingR = false;
		this.statusMessage = "";
	}

	private setMode(mode: Mode): void {
		this.mode = mode;
		if (mode === "visual" || mode === "visual-line") {
			const cursor = this.getCursor();
			this.visualAnchor = { line: cursor.line, col: cursor.col };
		} else {
			this.visualAnchor = null;
		}
		this.resetState();
	}

	private getVisualRange(): { start: Position; end: Position } | null {
		if (!this.visualAnchor) return null;
		const cursor = this.getCursor();
		const anchor = this.visualAnchor;

		// Determine start and end based on position
		let start: Position, end: Position;
		if (anchor.line < cursor.line || (anchor.line === cursor.line && anchor.col <= cursor.col)) {
			start = anchor;
			end = cursor;
		} else {
			start = cursor;
			end = anchor;
		}

		if (this.mode === "visual-line") {
			const lines = this.getLines();
			start = { line: start.line, col: 0 };
			end = { line: end.line, col: lines[end.line]?.length ?? 0 };
		}

		return { start, end };
	}

	private getSelectedText(): string {
		const range = this.getVisualRange();
		if (!range) return "";

		const lines = this.getLines();
		const { start, end } = range;

		if (start.line === end.line) {
			return lines[start.line]?.slice(start.col, end.col + 1) ?? "";
		}

		const result: string[] = [];
		for (let i = start.line; i <= end.line; i++) {
			const line = lines[i] ?? "";
			if (i === start.line) {
				result.push(line.slice(start.col));
			} else if (i === end.line) {
				result.push(line.slice(0, end.col + 1));
			} else {
				result.push(line);
			}
		}
		return result.join("\n");
	}

	private deleteSelection(): void {
		const range = this.getVisualRange();
		if (!range) return;

		const lines = this.getLines();
		const { start, end } = range;

		if (this.mode === "visual-line") {
			// Delete entire lines
			lines.splice(start.line, end.line - start.line + 1);
			if (lines.length === 0) lines.push("");
			const newLine = Math.min(start.line, lines.length - 1);
			this.setText(lines.join("\n"));
			this.setCursorPosition(newLine, 0);
		} else if (start.line === end.line) {
			// Single line deletion
			const line = lines[start.line] ?? "";
			lines[start.line] = line.slice(0, start.col) + line.slice(end.col + 1);
			this.setText(lines.join("\n"));
			this.setCursorPosition(start.line, start.col);
		} else {
			// Multi-line deletion
			const firstLine = lines[start.line] ?? "";
			const lastLine = lines[end.line] ?? "";
			lines[start.line] = firstLine.slice(0, start.col) + lastLine.slice(end.col + 1);
			lines.splice(start.line + 1, end.line - start.line);
			this.setText(lines.join("\n"));
			this.setCursorPosition(start.line, start.col);
		}
	}

	private setCursorPosition(line: number, col: number): void {
		const lines = this.getLines();
		const targetLine = Math.max(0, Math.min(line, lines.length - 1));
		const lineContent = lines[targetLine] ?? "";
		const targetCol = Math.max(0, Math.min(col, Math.max(0, lineContent.length - (this.mode === "insert" ? 0 : 1))));

		// Use setText to reset, then navigate
		// This is a workaround since we can't set cursor directly
		const text = this.getText();
		this.setText(text);

		// Navigate to position using escape sequences
		// First go to start
		const currentCursor = this.getCursor();

		// Move to correct line
		const lineDiff = targetLine - currentCursor.line;
		if (lineDiff > 0) {
			for (let i = 0; i < lineDiff; i++) {
				super.handleInput("\x1b[B"); // down
			}
		} else if (lineDiff < 0) {
			for (let i = 0; i < -lineDiff; i++) {
				super.handleInput("\x1b[A"); // up
			}
		}

		// Move to start of line then to correct column
		super.handleInput("\x01"); // ctrl+a - line start
		for (let i = 0; i < targetCol; i++) {
			super.handleInput("\x1b[C"); // right
		}
	}

	// Motion implementations - return new position without moving
	private motionLeft(pos: Position, count: number): Position {
		return { line: pos.line, col: Math.max(0, pos.col - count) };
	}

	private motionRight(pos: Position, count: number): Position {
		const lines = this.getLines();
		const lineLen = lines[pos.line]?.length ?? 0;
		const maxCol = this.mode === "insert" ? lineLen : Math.max(0, lineLen - 1);
		return { line: pos.line, col: Math.min(maxCol, pos.col + count) };
	}

	private motionUp(pos: Position, count: number): Position {
		return { line: Math.max(0, pos.line - count), col: pos.col };
	}

	private motionDown(pos: Position, count: number): Position {
		const lines = this.getLines();
		return { line: Math.min(lines.length - 1, pos.line + count), col: pos.col };
	}

	private motionLineStart(pos: Position): Position {
		return { line: pos.line, col: 0 };
	}

	private motionLineEnd(pos: Position): Position {
		const lines = this.getLines();
		const lineLen = lines[pos.line]?.length ?? 0;
		return { line: pos.line, col: Math.max(0, lineLen - (this.mode === "insert" ? 0 : 1)) };
	}

	private motionFirstNonWhitespace(pos: Position): Position {
		const lines = this.getLines();
		const line = lines[pos.line] ?? "";
		const match = line.match(/^\s*/);
		const col = match ? match[0].length : 0;
		return { line: pos.line, col: Math.min(col, Math.max(0, line.length - 1)) };
	}

	private motionWordForward(pos: Position, count: number): Position {
		const lines = this.getLines();
		let { line, col } = pos;

		for (let i = 0; i < count; i++) {
			const currentLine = lines[line] ?? "";

			// Skip current word
			while (col < currentLine.length && !this.isWhitespace(currentLine[col]!)) {
				col++;
			}
			// Skip whitespace
			while (col < currentLine.length && this.isWhitespace(currentLine[col]!)) {
				col++;
			}

			// If at end of line, go to next line
			if (col >= currentLine.length && line < lines.length - 1) {
				line++;
				col = 0;
				const nextLine = lines[line] ?? "";
				// Skip leading whitespace on new line
				while (col < nextLine.length && this.isWhitespace(nextLine[col]!)) {
					col++;
				}
			}
		}

		return { line, col };
	}

	private motionWordBackward(pos: Position, count: number): Position {
		const lines = this.getLines();
		let { line, col } = pos;

		for (let i = 0; i < count; i++) {
			const currentLine = lines[line] ?? "";

			// If at start of line, go to end of previous line
			if (col === 0 && line > 0) {
				line--;
				col = (lines[line]?.length ?? 1) - 1;
				continue;
			}

			// Move back one to get off current position
			if (col > 0) col--;

			// Skip whitespace backward
			while (col > 0 && this.isWhitespace(currentLine[col]!)) {
				col--;
			}

			// Skip word backward
			while (col > 0 && !this.isWhitespace(currentLine[col - 1]!)) {
				col--;
			}
		}

		return { line, col };
	}

	private motionWordEnd(pos: Position, count: number): Position {
		const lines = this.getLines();
		let { line, col } = pos;

		for (let i = 0; i < count; i++) {
			const currentLine = lines[line] ?? "";

			// Move forward one
			col++;

			// Skip whitespace
			while (col < currentLine.length && this.isWhitespace(currentLine[col]!)) {
				col++;
			}

			// If at end of line, go to next line
			if (col >= currentLine.length && line < lines.length - 1) {
				line++;
				col = 0;
				const nextLine = lines[line] ?? "";
				while (col < nextLine.length && this.isWhitespace(nextLine[col]!)) {
					col++;
				}
			}

			// Move to end of word
			const lineForWord = lines[line] ?? "";
			while (col < lineForWord.length - 1 && !this.isWhitespace(lineForWord[col + 1]!)) {
				col++;
			}
		}

		return { line, col };
	}

	private motionDocumentStart(): Position {
		return { line: 0, col: 0 };
	}

	private motionDocumentEnd(): Position {
		const lines = this.getLines();
		const lastLine = lines.length - 1;
		return { line: lastLine, col: 0 };
	}

	private isWhitespace(char: string): boolean {
		return /\s/.test(char);
	}

	private executeMotion(key: string): Position | null {
		const cursor = this.getCursor();
		const count = this.getCount();

		switch (key) {
			case "h":
				return this.motionLeft(cursor, count);
			case "l":
				return this.motionRight(cursor, count);
			case "j":
				return this.motionDown(cursor, count);
			case "k":
				return this.motionUp(cursor, count);
			case "w":
				return this.motionWordForward(cursor, count);
			case "b":
				return this.motionWordBackward(cursor, count);
			case "e":
				return this.motionWordEnd(cursor, count);
			case "0":
				return this.motionLineStart(cursor);
			case "$":
				return this.motionLineEnd(cursor);
			case "^":
				return this.motionFirstNonWhitespace(cursor);
			case "G":
				return this.count > 0 ? { line: this.count - 1, col: 0 } : this.motionDocumentEnd();
			default:
				return null;
		}
	}

	private executeOperatorMotion(operator: Operator, motion: string): void {
		const cursor = this.getCursor();
		const lines = this.getLines();

		// Special case: cw acts like ce when cursor is on a non-blank (vi behavior)
		let effectiveMotion = motion;
		if (operator === "c" && motion === "w") {
			const currentLine = lines[cursor.line] ?? "";
			const currentChar = currentLine[cursor.col] ?? "";
			if (currentChar && !this.isWhitespace(currentChar)) {
				effectiveMotion = "e";
			}
		}

		const target = this.executeMotion(effectiveMotion);
		if (!target) return;

		// Determine range
		let start: Position, end: Position;
		if (cursor.line < target.line || (cursor.line === target.line && cursor.col < target.col)) {
			start = cursor;
			end = target;
		} else {
			start = target;
			end = cursor;
		}

		// w motion is exclusive (don't include the target character)
		// e, $, and other motions are inclusive
		const isExclusiveMotion = effectiveMotion === "w";
		if (isExclusiveMotion && (end.line > start.line || end.col > start.col)) {
			// Move end back by one character
			if (end.col > 0) {
				end = { line: end.line, col: end.col - 1 };
			} else if (end.line > 0) {
				// End is at start of a line, go to end of previous line
				const prevLineLen = lines[end.line - 1]?.length ?? 0;
				end = { line: end.line - 1, col: Math.max(0, prevLineLen - 1) };
			}
		}

		// Get text in range
		let text: string;
		if (start.line === end.line) {
			text = lines[start.line]?.slice(start.col, end.col + 1) ?? "";
		} else {
			const parts: string[] = [];
			for (let i = start.line; i <= end.line; i++) {
				const line = lines[i] ?? "";
				if (i === start.line) {
					parts.push(line.slice(start.col));
				} else if (i === end.line) {
					parts.push(line.slice(0, end.col + 1));
				} else {
					parts.push(line);
				}
			}
			text = parts.join("\n");
		}

		// Execute operator
		if (operator === "y") {
			this.register = text;
			this.statusMessage = `Yanked ${text.length} chars`;
		} else if (operator === "d" || operator === "c") {
			this.register = text;

			// Delete the text
			if (start.line === end.line) {
				const line = lines[start.line] ?? "";
				lines[start.line] = line.slice(0, start.col) + line.slice(end.col + 1);
			} else {
				const firstLine = lines[start.line] ?? "";
				const lastLine = lines[end.line] ?? "";
				lines[start.line] = firstLine.slice(0, start.col) + lastLine.slice(end.col + 1);
				lines.splice(start.line + 1, end.line - start.line);
			}

			this.setText(lines.join("\n"));
			if (operator === "c") {
				this.setMode("insert");
			}
			this.setCursorPosition(start.line, start.col);
		}

		this.resetState();
	}

	private executeLineOperator(operator: Operator): void {
		const cursor = this.getCursor();
		const count = this.getCount();
		const lines = this.getLines();
		const endLine = Math.min(cursor.line + count - 1, lines.length - 1);

		// Get the lines
		const text = `${lines.slice(cursor.line, endLine + 1).join("\n")}\n`;

		if (operator === "y") {
			this.register = text;
			this.statusMessage = `Yanked ${count} line(s)`;
		} else if (operator === "d" || operator === "c") {
			this.register = text;

			// Delete the lines
			lines.splice(cursor.line, endLine - cursor.line + 1);
			if (lines.length === 0) lines.push("");

			this.setText(lines.join("\n"));
			const newLine = Math.min(cursor.line, lines.length - 1);
			this.setCursorPosition(newLine, 0);

			if (operator === "c") {
				// For cc, open a new line at cursor position
				const l = this.getLines();
				l.splice(newLine, 0, "");
				this.setText(l.join("\n"));
				this.setCursorPosition(newLine, 0);
				this.setMode("insert");
			}
		}

		this.resetState();
	}

	handleInput(data: string): void {
		// Escape handling
		if (matchesKey(data, "escape")) {
			if (this.mode === "insert") {
				this.setMode("normal");
				// In vim, cursor moves back one when exiting insert mode
				const cursor = this.getCursor();
				if (cursor.col > 0) {
					super.handleInput("\x1b[D"); // left
				}
				return;
			} else if (this.mode === "visual" || this.mode === "visual-line") {
				this.setMode("normal");
				return;
			} else if (this.operator || this.count > 0 || this.pendingG || this.pendingR) {
				this.resetState();
				return;
			} else {
				// In normal mode with no pending state, pass to app (abort)
				super.handleInput(data);
				return;
			}
		}

		// Insert mode - pass through
		if (this.mode === "insert") {
			super.handleInput(data);
			return;
		}

		// Ctrl sequences - pass through (ctrl+c, ctrl+d, etc.)
		if (data.length === 1 && data.charCodeAt(0) < 32 && data !== "\x1b") {
			super.handleInput(data);
			return;
		}

		// Handle pending r<char> for replace
		if (this.pendingR) {
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				const cursor = this.getCursor();
				const lines = this.getLines();
				const line = lines[cursor.line] ?? "";
				if (cursor.col < line.length) {
					lines[cursor.line] = line.slice(0, cursor.col) + data + line.slice(cursor.col + 1);
					this.setText(lines.join("\n"));
					this.setCursorPosition(cursor.line, cursor.col);
				}
			}
			this.resetState();
			return;
		}

		// Normal and Visual mode handling
		const key = data;

		// Number prefix for count
		if (/^[1-9]$/.test(key) || (this.count > 0 && key === "0")) {
			this.count = this.count * 10 + parseInt(key, 10);
			return;
		}

		// Handle gg
		if (this.pendingG) {
			if (key === "g") {
				const pos = this.motionDocumentStart();
				if (this.mode === "visual" || this.mode === "visual-line") {
					this.setCursorPosition(pos.line, pos.col);
				} else if (this.operator) {
					// Operator from current to start
					const cursor = this.getCursor();
					this.visualAnchor = cursor;
					this.mode = "visual";
					this.setCursorPosition(pos.line, pos.col);
					const text = this.getSelectedText();
					this.register = text;
					this.deleteSelection();
					this.setMode("normal");
					if (this.operator === "c") {
						this.setMode("insert");
					}
				} else {
					this.setCursorPosition(pos.line, pos.col);
				}
				this.resetState();
				return;
			}
			this.resetState();
		}

		// Visual mode operators
		if (
			(this.mode === "visual" || this.mode === "visual-line") &&
			(key === "d" || key === "x" || key === "c" || key === "y")
		) {
			const text = this.getSelectedText();
			this.register = text;

			if (key === "y") {
				this.statusMessage = `Yanked ${text.length} chars`;
				this.setMode("normal");
			} else {
				this.deleteSelection();
				if (key === "c") {
					this.setMode("insert");
				} else {
					this.setMode("normal");
				}
			}
			this.resetState();
			return;
		}

		// Operators in normal mode
		if (this.mode === "normal" && (key === "d" || key === "c" || key === "y")) {
			if (this.operator === key) {
				// dd, cc, yy - line operation
				this.executeLineOperator(key);
				return;
			}
			this.operator = key;
			return;
		}

		// Motions
		const isMotion = /^[hjklwbeG0$^]$/.test(key);
		if (isMotion) {
			const newPos = this.executeMotion(key);
			if (newPos) {
				if (this.operator && this.mode === "normal") {
					this.executeOperatorMotion(this.operator, key);
				} else {
					this.setCursorPosition(newPos.line, newPos.col);
					this.resetState();
				}
			}
			return;
		}

		// g prefix
		if (key === "g") {
			this.pendingG = true;
			return;
		}

		// Mode switches
		if (this.mode === "normal") {
			switch (key) {
				case "i":
					this.setMode("insert");
					return;
				case "a":
					this.setMode("insert");
					super.handleInput("\x1b[C"); // right
					return;
				case "A":
					this.setMode("insert");
					super.handleInput("\x05"); // ctrl+e - end of line
					return;
				case "I":
					this.setMode("insert");
					super.handleInput("\x01"); // ctrl+a - start of line
					return;
				case "o":
					super.handleInput("\x05"); // end of line
					super.handleInput("\n"); // new line
					this.setMode("insert");
					return;
				case "O":
					super.handleInput("\x01"); // start of line
					super.handleInput("\n"); // new line
					super.handleInput("\x1b[A"); // up
					this.setMode("insert");
					return;
				case "v":
					this.setMode("visual");
					return;
				case "V":
					this.setMode("visual-line");
					return;
				case "x": {
					// Delete char under cursor
					const count = this.getCount();
					for (let i = 0; i < count; i++) {
						super.handleInput("\x1b[3~"); // delete
					}
					this.resetState();
					return;
				}
				case "X": {
					// Delete char before cursor
					const count = this.getCount();
					for (let i = 0; i < count; i++) {
						super.handleInput("\x7f"); // backspace
					}
					this.resetState();
					return;
				}
				case "r":
					this.pendingR = true;
					return;
				case "p": {
					// Paste after cursor
					if (this.register) {
						if (this.register.endsWith("\n")) {
							// Line-wise paste
							super.handleInput("\x05"); // end of line
							super.handleInput("\n");
							this.insertTextAtCursor(this.register.slice(0, -1));
						} else {
							super.handleInput("\x1b[C"); // right
							this.insertTextAtCursor(this.register);
						}
					}
					this.resetState();
					return;
				}
				case "P": {
					// Paste before cursor
					if (this.register) {
						if (this.register.endsWith("\n")) {
							// Line-wise paste
							super.handleInput("\x01"); // start of line
							this.insertTextAtCursor(this.register);
							super.handleInput("\x1b[A"); // up
						} else {
							this.insertTextAtCursor(this.register);
						}
					}
					this.resetState();
					return;
				}
				case "u":
					// Undo - ctrl+_ (0x1f) is the legacy code for ctrl+-
					super.handleInput("\x1f");
					this.resetState();
					return;
				case "J": {
					// Join lines
					const cursor = this.getCursor();
					const lines = this.getLines();
					if (cursor.line < lines.length - 1) {
						const currentLine = lines[cursor.line] ?? "";
						const nextLine = lines[cursor.line + 1] ?? "";
						lines[cursor.line] = `${currentLine} ${nextLine.trimStart()}`;
						lines.splice(cursor.line + 1, 1);
						this.setText(lines.join("\n"));
						this.setCursorPosition(cursor.line, currentLine.length);
					}
					this.resetState();
					return;
				}
			}
		}

		// In visual mode, motions extend selection
		if (this.mode === "visual" || this.mode === "visual-line") {
			// Already handled motions above
		}

		this.resetState();
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		// Build mode indicator
		let modeLabel: string;
		switch (this.mode) {
			case "normal":
				modeLabel = " NORMAL ";
				break;
			case "insert":
				modeLabel = " INSERT ";
				break;
			case "visual":
				modeLabel = " VISUAL ";
				break;
			case "visual-line":
				modeLabel = " V-LINE ";
				break;
		}

		// Add pending operator/count
		let pending = "";
		if (this.count > 0) pending += this.count;
		if (this.operator) pending += this.operator;
		if (this.pendingG) pending += "g";
		if (this.pendingR) pending += "r";
		if (pending) modeLabel = ` ${pending}${modeLabel}`;

		// Add status message
		if (this.statusMessage) {
			modeLabel = ` ${this.statusMessage}${modeLabel}`;
		}

		// Add to bottom border
		const last = lines.length - 1;
		const lastLine = lines[last] ?? "";
		if (visibleWidth(lastLine) >= modeLabel.length) {
			lines[last] = truncateToWidth(lastLine, width - modeLabel.length, "") + modeLabel;
		}

		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, kb) => new VimEditor(tui, theme, kb));
		ctx.ui.notify("Vim mode enabled (start in INSERT mode)", "info");
	});
}
