#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="pi-tui-screenshots"
SESSION_FILE="$ROOT_DIR/packages/coding-agent/test/fixtures/tui-regression.jsonl"
OUTPUT_DIR="$ROOT_DIR/.tmp/tui-screenshots"
RAW_DIR="$OUTPUT_DIR/raw"
WORKSPACE_DIR="$ROOT_DIR/compaction-results/tui-screenshots-workspace"
FIXTURES_DIR="$ROOT_DIR/packages/coding-agent/test/fixtures/tui-screenshots"
TERM_COLUMNS=${TERM_COLUMNS:-100}
TERM_ROWS=${TERM_ROWS:-28}

COMPARE=false
UPDATE=false

for arg in "$@"; do
	case "$arg" in
		--compare)
			COMPARE=true
			;;
		--update)
			UPDATE=true
			;;
		--help|-h)
			echo "Usage: scripts/tui-screenshots.sh [--compare] [--update]"
			exit 0
			;;
	esac
done

if [ "$UPDATE" = true ]; then
	COMPARE=false
fi

if ! command -v tmux >/dev/null 2>&1; then
	echo "tmux is required to run the TUI screenshot harness."
	exit 1
fi

if ! command -v termshot >/dev/null 2>&1; then
	echo "termshot is required. Install with: brew install termshot"
	exit 1
fi

if [ ! -f "$SESSION_FILE" ]; then
	echo "Missing session fixture: $SESSION_FILE"
	exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-tui-screenshots.XXXXXX")"
cleanup() {
	tmux kill-session -t "$SESSION_NAME" >/dev/null 2>&1 || true
	rm -rf "$TMP_DIR"
	rm -rf "$WORKSPACE_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$RAW_DIR"

rm -rf "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR"

git -C "$WORKSPACE_DIR" init -q -b main

git -C "$WORKSPACE_DIR" config user.email "tui-screenshot@example.com"

git -C "$WORKSPACE_DIR" config user.name "TUI Screenshot"

echo '{"name":"tui-workspace"}' > "$WORKSPACE_DIR/package.json"

git -C "$WORKSPACE_DIR" add package.json

git -C "$WORKSPACE_DIR" commit -q -m "init"

echo '{
  "name": "tui-workspace",
  "dirty": true
}' > "$WORKSPACE_DIR/package.json"

SESSIONS_DIR="$TMP_DIR/sessions"
mkdir -p "$SESSIONS_DIR"
SESSION_COPY="$SESSIONS_DIR/tui-regression.jsonl"
cp "$SESSION_FILE" "$SESSION_COPY"

cat > "$TMP_DIR/keybindings.json" <<'JSON'
{
	"toggleBlocks": "ctrl+b",
	"blockActions": "ctrl+a",
	"commandPalette": "ctrl+k",
	"cycleBlockFilter": "ctrl+f"
}
JSON

cat > "$TMP_DIR/settings.json" <<'JSON'
{
	"quietStartup": true,
	"defaultThinkingLevel": "off"
}
JSON

cat > "$TMP_DIR/auth.json" <<'JSON'
{
	"anthropic": {
		"type": "api_key",
		"key": "tui-regression"
	}
}
JSON

tmux new-session -d -s "$SESSION_NAME" -x "$TERM_COLUMNS" -y "$TERM_ROWS"

tmux send-keys -t "$SESSION_NAME" "cd \"$WORKSPACE_DIR\"" Enter

tmux send-keys -t "$SESSION_NAME" "PI_SKIP_VERSION_CHECK=1 PI_CODING_AGENT_DIR=\"$TMP_DIR\" \"$ROOT_DIR/pi-test.sh\" --no-env --continue --session-dir \"$SESSIONS_DIR\"" Enter

wait_for_text() {
	local needle="$1"
	local attempts=40
	local delay=0.25
	for ((i=0; i<attempts; i++)); do
		if tmux capture-pane -t "$SESSION_NAME" -p | grep -q "$needle"; then
			return 0
		fi
		sleep "$delay"
	done
	return 1
}

compare_raw() {
	local name="$1"
	local raw_file="$RAW_DIR/${name}.txt"
	local fixture_file="$FIXTURES_DIR/${name}.txt"

	if [ "$UPDATE" = true ]; then
		mkdir -p "$FIXTURES_DIR"
		cp "$raw_file" "$fixture_file"
		echo "Updated fixture: $fixture_file"
		return 0
	fi

	if [ "$COMPARE" = true ]; then
		if [ ! -f "$fixture_file" ]; then
			echo "Missing screenshot fixture: $fixture_file"
			exit 1
		fi
		if ! diff -u "$fixture_file" "$raw_file"; then
			echo "Screenshot snapshot mismatch for $name. Raw output: $raw_file"
			exit 1
		fi
	fi
}

capture_screen() {
	local name="$1"
	local raw_file="$RAW_DIR/${name}.txt"
	local png_file="$OUTPUT_DIR/${name}.png"
	tmux capture-pane -t "$SESSION_NAME" -p -e > "$raw_file"
	termshot \
		--raw-read "$raw_file" \
		--filename "$png_file" \
		--columns "$TERM_COLUMNS" \
		--no-decoration \
		--no-shadow \
		--clip-canvas \
		>/dev/null
	echo "Wrote $png_file"
	compare_raw "$name"
}

if ! wait_for_text "Step 1"; then
	echo "TUI did not render the session within the expected time."
	exit 1
fi

capture_screen "tui-main"

# Block actions palette (target list)
tmux send-keys -t "$SESSION_NAME" C-a
if ! wait_for_text "Block actions"; then
	echo "Block action palette did not render."
	exit 1
fi
capture_screen "tui-block-actions-targets"

# Block actions palette (actions list)
tmux send-keys -t "$SESSION_NAME" Enter
if ! wait_for_text "Block actions •"; then
	echo "Block action details did not render."
	exit 1
fi
capture_screen "tui-block-actions-actions"

tmux send-keys -t "$SESSION_NAME" Escape
sleep 0.2

tmux send-keys -t "$SESSION_NAME" Escape
sleep 0.2

# Command palette filtered
tmux send-keys -t "$SESSION_NAME" C-k
if ! wait_for_text "Command palette"; then
	echo "Command palette did not render."
	exit 1
fi

tmux send-keys -t "$SESSION_NAME" "block"
if ! wait_for_text "Block actions"; then
	echo "Command palette filter did not render."
	exit 1
fi
capture_screen "tui-command-palette"

# Select block filter (No tools)
tmux send-keys -t "$SESSION_NAME" Down
sleep 0.1

tmux send-keys -t "$SESSION_NAME" Down
sleep 0.1

capture_screen "tui-command-palette-selection"

tmux send-keys -t "$SESSION_NAME" Enter
sleep 0.3
capture_screen "tui-filter-attempt"
if ! wait_for_text "Block filter: No tools"; then
	# Fallback to keybinding
	tmux send-keys -t "$SESSION_NAME" C-f
	sleep 0.3
	capture_screen "tui-filter-fallback"
fi

if ! wait_for_text "Block filter: No tools"; then
	echo "Filtered view did not render."
	exit 1
fi
capture_screen "tui-filtered"

echo "Screenshots saved to $OUTPUT_DIR"