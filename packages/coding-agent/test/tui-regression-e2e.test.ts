import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "vitest";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const SCRIPTS_DIR = path.join(ROOT_DIR, "scripts");

function hasCommand(command: string): boolean {
	const result = spawnSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
	return result.status === 0;
}

function runScript(scriptName: string, args: string[] = []): void {
	const scriptPath = path.join(SCRIPTS_DIR, scriptName);
	const result = spawnSync("bash", [scriptPath, ...args], {
		cwd: ROOT_DIR,
		stdio: "inherit",
		env: { ...process.env },
	});
	if (result.status !== 0) {
		throw new Error(`Script failed: ${scriptName}`);
	}
}

describe("tui regression e2e", () => {
	const hasTmux = hasCommand("tmux");
	const hasTermshot = hasCommand("termshot");

	(hasTmux ? test : test.skip)("matches text snapshot", () => {
		runScript("tui-regression.sh");
	});

	(hasTmux && hasTermshot ? test : test.skip)("matches screenshot fixtures", () => {
		runScript("tui-screenshots.sh", ["--compare"]);
	});
});
