#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="pi-tui-regression"
SESSION_FILE="$ROOT_DIR/packages/coding-agent/test/fixtures/tui-regression.jsonl"
SNAPSHOT_FILE="$ROOT_DIR/packages/coding-agent/test/fixtures/tui-regression.snapshot.txt"
OUTPUT_DIR="$ROOT_DIR/.tmp"
OUTPUT_FILE="$OUTPUT_DIR/tui-regression-output.txt"
RAW_OUTPUT_FILE="$OUTPUT_DIR/tui-regression-output-raw.txt"
WORKSPACE_DIR="$ROOT_DIR/compaction-results/tui-workspace"

UPDATE=false

for arg in "$@"; do
	case "$arg" in
		--update)
			UPDATE=true
			;;
		--help|-h)
			echo "Usage: scripts/tui-regression.sh [--update]"
			exit 0
			;;
	esac
done

if ! command -v tmux >/dev/null 2>&1; then
	echo "tmux is required to run the TUI regression harness."
	exit 1
fi

if [ ! -f "$SESSION_FILE" ]; then
	echo "Missing session fixture: $SESSION_FILE"
	exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-tui-regression.XXXXXX")"
cleanup() {
	tmux kill-session -t "$SESSION_NAME" >/dev/null 2>&1 || true
	rm -rf "$TMP_DIR"
	rm -rf "$WORKSPACE_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"

rm -rf "$WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR"

git -C "$WORKSPACE_DIR" init -q -b main

git -C "$WORKSPACE_DIR" config user.email "tui-regression@example.com"

git -C "$WORKSPACE_DIR" config user.name "TUI Regression"

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
	"toggleBlocks": "ctrl+b"
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

tmux new-session -d -s "$SESSION_NAME" -x 80 -y 24

tmux send-keys -t "$SESSION_NAME" "cd \"$WORKSPACE_DIR\"" Enter

tmux send-keys -t "$SESSION_NAME" "PI_SKIP_VERSION_CHECK=1 PI_CODING_AGENT_DIR=\"$TMP_DIR\" \"$ROOT_DIR/pi-test.sh\" --no-env --continue --session-dir \"$SESSIONS_DIR\"" Enter

wait_for_render() {
	local attempts=40
	local delay=0.25
	for ((i=0; i<attempts; i++)); do
		if tmux capture-pane -t "$SESSION_NAME" -p | grep -q "Step 1"; then
			return 0
		fi
		sleep "$delay"
	done
	return 1
}

normalize_output() {
	local input="$1"
	local output="$2"
	local short_workspace="$WORKSPACE_DIR"
	if [[ "$short_workspace" == "$HOME"* ]]; then
		short_workspace="~${short_workspace#$HOME}"
	fi
	sed -e "s|$WORKSPACE_DIR|~/tui-workspace|g" -e "s|$short_workspace|~/tui-workspace|g" "$input" > "$output"
}

if ! wait_for_render; then
	echo "TUI did not render the session within the expected time."
	exit 1
fi

tmux send-keys -t "$SESSION_NAME" C-b
sleep 0.5

tmux capture-pane -t "$SESSION_NAME" -p > "$RAW_OUTPUT_FILE"
normalize_output "$RAW_OUTPUT_FILE" "$OUTPUT_FILE"

if [ "$UPDATE" = true ]; then
	cp "$OUTPUT_FILE" "$SNAPSHOT_FILE"
	echo "Updated snapshot: $SNAPSHOT_FILE"
	exit 0
fi

if [ ! -f "$SNAPSHOT_FILE" ]; then
	echo "Snapshot missing. Run with --update to create: $SNAPSHOT_FILE"
	exit 1
fi

if ! diff -u "$SNAPSHOT_FILE" "$OUTPUT_FILE"; then
	echo "Snapshot mismatch. Output: $OUTPUT_FILE"
	exit 1
fi

echo "Snapshot matches."
