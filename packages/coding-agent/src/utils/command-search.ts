import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { createReadStream, type Dirent, existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";
import { getSessionsDir } from "../config.js";

export type CommandSearchEntry = {
	id: string;
	text: string;
	type: "user" | "bash";
	timestamp?: string;
};

export type CommandSearchSession = {
	path: string;
	name?: string;
	cwd?: string;
	modified: Date;
	commands: CommandSearchEntry[];
};

export type CommandSearchIndexOptions = {
	maxSessions?: number;
	maxCommandsPerSession?: number;
};

type SessionFileInfo = { path: string; mtimeMs: number };

type CachedSession = {
	mtimeMs: number;
	session: CommandSearchSession;
};

const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_MAX_COMMANDS_PER_SESSION = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTextContent(value: unknown): value is TextContent {
	return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function extractTextFromMessage(message: AgentMessage): string | null {
	if (message.role === "user") {
		if (typeof message.content === "string") {
			return message.content;
		}
		if (Array.isArray(message.content)) {
			const parts = message.content.filter(isTextContent).map((part) => part.text);
			return parts.join("");
		}
		return null;
	}

	if (message.role === "bashExecution") {
		return message.command;
	}

	return null;
}

function extractCommandEntry(message: AgentMessage, entryId: string, timestamp?: string): CommandSearchEntry | null {
	const text = extractTextFromMessage(message);
	if (!text) return null;
	const type = message.role === "bashExecution" ? "bash" : "user";
	return { id: entryId, text, type, timestamp };
}

async function listSessionFiles(): Promise<SessionFileInfo[]> {
	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) return [];

	let entries: Dirent[] = [];
	try {
		entries = await readdir(sessionsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const dirs = entries.filter((entry) => entry.isDirectory());
	const files: SessionFileInfo[] = [];

	for (const dir of dirs) {
		const dirPath = join(sessionsDir, dir.name);
		let dirEntries: string[] = [];
		try {
			dirEntries = await readdir(dirPath);
		} catch {
			continue;
		}
		const sessionFiles = dirEntries.filter((name) => name.endsWith(".jsonl"));
		const stats = await Promise.all(
			sessionFiles.map(async (name) => {
				const filePath = join(dirPath, name);
				try {
					const fileStat = await stat(filePath);
					return { path: filePath, mtimeMs: fileStat.mtimeMs } as SessionFileInfo;
				} catch {
					return null;
				}
			}),
		);
		for (const info of stats) {
			if (info) files.push(info);
		}
	}

	return files;
}

async function loadSessionCommandHistory(
	filePath: string,
	mtimeMs: number,
	maxCommands: number,
): Promise<CommandSearchSession | null> {
	let headerCwd: string | undefined;
	let sessionName: string | undefined;

	const commands: CommandSearchEntry[] = [];
	let lineIndex = 0;

	try {
		const stream = createReadStream(filePath, { encoding: "utf-8" });
		const rl = createInterface({ input: stream, crlfDelay: Infinity });

		for await (const line of rl) {
			lineIndex += 1;
			const trimmed = line.trim();
			if (!trimmed) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				continue;
			}
			if (!isRecord(parsed) || typeof parsed.type !== "string") continue;

			if (parsed.type === "session") {
				if (typeof parsed.cwd === "string") {
					headerCwd = parsed.cwd;
				}
				continue;
			}

			if (parsed.type === "session_info") {
				const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
				if (name) {
					sessionName = name;
				}
				continue;
			}

			if (parsed.type !== "message") continue;
			const message = parsed.message;
			if (!isRecord(message) || typeof message.role !== "string") continue;

			const entryId = typeof parsed.id === "string" ? parsed.id : `${filePath}:${lineIndex}`;
			const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
			const commandEntry = extractCommandEntry(message as unknown as AgentMessage, entryId, timestamp);
			if (!commandEntry) continue;

			commands.push(commandEntry);
			if (commands.length > maxCommands) {
				commands.shift();
			}
		}
	} catch {
		return null;
	}

	commands.reverse();

	return {
		path: filePath,
		name: sessionName,
		cwd: headerCwd,
		modified: new Date(mtimeMs),
		commands,
	};
}

export class CommandSearchIndex {
	private cache = new Map<string, CachedSession>();
	private maxSessions: number;
	private maxCommandsPerSession: number;

	constructor(options: CommandSearchIndexOptions = {}) {
		this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
		this.maxCommandsPerSession = options.maxCommandsPerSession ?? DEFAULT_MAX_COMMANDS_PER_SESSION;
	}

	async loadSessions(): Promise<CommandSearchSession[]> {
		const files = await listSessionFiles();
		files.sort((a, b) => b.mtimeMs - a.mtimeMs);
		const trimmedFiles = files.slice(0, this.maxSessions);

		const sessions: CommandSearchSession[] = [];
		for (const file of trimmedFiles) {
			const cached = this.cache.get(file.path);
			if (cached && cached.mtimeMs === file.mtimeMs) {
				sessions.push(cached.session);
				continue;
			}
			const session = await loadSessionCommandHistory(file.path, file.mtimeMs, this.maxCommandsPerSession);
			if (!session) continue;
			this.cache.set(file.path, { mtimeMs: file.mtimeMs, session });
			sessions.push(session);
		}
		return sessions;
	}
}
