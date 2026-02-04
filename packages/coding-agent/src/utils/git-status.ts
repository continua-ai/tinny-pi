import { execSync } from "child_process";
import { findGitPaths, getGitBranch } from "./git.js";

export type GitDiffSummary = {
	filesChanged: number;
	insertions: number;
	deletions: number;
};

export type GitStatusSummary = {
	branch: string | null;
	dirty: boolean;
	diff: GitDiffSummary | null;
};

function parseShortStat(text: string): GitDiffSummary {
	const trimmed = text.trim();
	if (!trimmed) {
		return { filesChanged: 0, insertions: 0, deletions: 0 };
	}

	const filesMatch = trimmed.match(/(\d+) file/);
	const insertionsMatch = trimmed.match(/(\d+) insertion/);
	const deletionsMatch = trimmed.match(/(\d+) deletion/);

	return {
		filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
		insertions: insertionsMatch ? Number(insertionsMatch[1]) : 0,
		deletions: deletionsMatch ? Number(deletionsMatch[1]) : 0,
	};
}

function mergeShortStat(first: GitDiffSummary, second: GitDiffSummary): GitDiffSummary {
	return {
		filesChanged: first.filesChanged + second.filesChanged,
		insertions: first.insertions + second.insertions,
		deletions: first.deletions + second.deletions,
	};
}

function getStatusFiles(output: string): number {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const files = new Set<string>();
	for (const line of lines) {
		const pathPart = line.slice(3).trim();
		if (!pathPart) continue;
		const file = pathPart.includes("->") ? pathPart.split("->").pop()?.trim() : pathPart;
		if (file) files.add(file);
	}

	return files.size;
}

export function getGitStatusSummary(cwd: string = process.cwd()): GitStatusSummary | null {
	const paths = findGitPaths(cwd);
	if (!paths) return null;

	const branch = getGitBranch(cwd);
	let statusOutput = "";
	try {
		statusOutput = execSync("git status --porcelain", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		});
	} catch {
		return { branch, dirty: false, diff: null };
	}

	const trimmed = statusOutput.trim();
	if (!trimmed) {
		return { branch, dirty: false, diff: null };
	}

	const filesChanged = getStatusFiles(trimmed);
	let diffSummary: GitDiffSummary = { filesChanged: 0, insertions: 0, deletions: 0 };
	try {
		const unstaged = execSync("git diff --shortstat", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		});
		const staged = execSync("git diff --shortstat --cached", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
		});
		diffSummary = mergeShortStat(parseShortStat(unstaged), parseShortStat(staged));
	} catch {
		// Ignore diff errors; we'll still show file count
	}

	return {
		branch,
		dirty: true,
		diff: {
			filesChanged,
			insertions: diffSummary.insertions,
			deletions: diffSummary.deletions,
		},
	};
}
