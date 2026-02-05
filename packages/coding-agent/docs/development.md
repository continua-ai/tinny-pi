# Development

See [AGENTS.md](../../../AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/badlogic/pi-mono
cd pi-mono
npm install
npm run build
```

Run from source:

```bash
./pi-test.sh
```

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.pi/agent/pi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

### TUI Regression Harness (tmux)

```bash
scripts/tui-regression.sh --update  # Record snapshot
scripts/tui-regression.sh           # Compare to snapshot
```

Uses `packages/coding-agent/test/fixtures/tui-regression.jsonl` and a temporary agent config to capture a deterministic 80x24 TUI snapshot in tmux.

### TUI Screenshot Harness (tmux + termshot)

```bash
scripts/tui-screenshots.sh --update   # Record fixtures + screenshots
scripts/tui-screenshots.sh --compare  # Compare fixtures + regenerate screenshots
scripts/tui-screenshots.sh            # Capture screenshots without comparison
```

Uses `packages/coding-agent/test/fixtures/tui-screenshots/*.txt` for raw snapshots and writes PNGs to `.tmp/tui-screenshots`.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
