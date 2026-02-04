import { type FSWatcher, watch } from "fs";
import { dirname } from "path";
import { findGitHeadPath, getGitBranch } from "../utils/git.js";

/**
 * Provides git branch and extension statuses - data not otherwise accessible to extensions.
 * Token stats, model info available via ctx.sessionManager and ctx.model.
 */
export class FooterDataProvider {
	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null | undefined = undefined;
	private gitWatcher: FSWatcher | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;

	constructor() {
		this.setupGitWatcher();
	}

	/** Current git branch, null if not in repo, "detached" if detached HEAD */
	getGitBranch(): string | null {
		if (this.cachedBranch !== undefined) return this.cachedBranch;

		const branch = getGitBranch();
		this.cachedBranch = branch;
		return this.cachedBranch;
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	/** Subscribe to git branch changes. Returns unsubscribe function. */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	/** Internal: cleanup */
	dispose(): void {
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}
		this.branchChangeCallbacks.clear();
	}

	private setupGitWatcher(): void {
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}

		const gitHeadPath = findGitHeadPath();
		if (!gitHeadPath) return;

		// Watch the directory containing HEAD, not HEAD itself.
		// Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
		// fs.watch on a file stops working after the inode changes.
		const gitDir = dirname(gitHeadPath);

		try {
			this.gitWatcher = watch(gitDir, (_eventType, filename) => {
				if (filename === "HEAD") {
					this.cachedBranch = undefined;
					for (const cb of this.branchChangeCallbacks) cb();
				}
			});
		} catch {
			// Silently fail if we can't watch
		}
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	"getGitBranch" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
>;
