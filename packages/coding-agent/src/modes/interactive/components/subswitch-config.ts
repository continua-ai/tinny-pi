import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface SubswitchConfig {
	enabled?: boolean;
}

function readJson(path: string): unknown {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

/**
 * Returns true if subscription-fallback (/subswitch) is enabled.
 *
 * Mirrors the extension's config lookup behavior:
 * - global: ~/.pi/agent/subscription-fallback.json
 * - project: <cwd>/.pi/subscription-fallback.json
 *
 * Project config overrides global.
 */
export function isSubswitchEnabled(cwd: string): boolean {
	const globalPath = join(homedir(), ".pi", "agent", "subscription-fallback.json");
	const projectPath = join(cwd, ".pi", "subscription-fallback.json");

	const globalCfg = (readJson(globalPath) ?? {}) as SubswitchConfig;
	const projectCfg = (readJson(projectPath) ?? {}) as SubswitchConfig;

	const merged: SubswitchConfig = {
		enabled: true,
		...globalCfg,
		...projectCfg,
	};

	return merged.enabled !== false;
}
