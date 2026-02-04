import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

export type GitPaths = {
	gitDir: string;
	headPath: string;
};

/**
 * Find the git HEAD path by walking up from cwd.
 * Handles both regular git repos (.git is a directory) and worktrees (.git is a file).
 */
export function findGitHeadPath(cwd: string = process.cwd()): string | null {
	let dir = cwd;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8));
						const headPath = join(gitDir, "HEAD");
						if (existsSync(headPath)) return headPath;
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (existsSync(headPath)) return headPath;
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function findGitPaths(cwd: string = process.cwd()): GitPaths | null {
	const headPath = findGitHeadPath(cwd);
	if (!headPath) return null;
	return { gitDir: dirname(headPath), headPath };
}

export function getGitBranch(cwd: string = process.cwd()): string | null {
	try {
		const headPath = findGitHeadPath(cwd);
		if (!headPath) return null;
		const content = readFileSync(headPath, "utf8").trim();
		return content.startsWith("ref: refs/heads/") ? content.slice(16) : "detached";
	} catch {
		return null;
	}
}

export function looksLikeGitUrl(source: string): boolean {
	if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/") || source.startsWith("~")) {
		return false;
	}
	if (existsSync(source) || existsSync(resolve(process.cwd(), source))) {
		return false;
	}
	if (source.startsWith("git@")) return true;
	if (source.startsWith("ssh://")) return true;
	if (source.startsWith("https://") || source.startsWith("http://")) return true;
	// Handle shorthand owner/repo or host/owner/repo
	return /^[\w.-]+\/[\w.-]+(\/[\w.-]+)?(\.git)?$/.test(source);
}
