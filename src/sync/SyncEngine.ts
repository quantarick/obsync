// ============================================================
// Obsync — Sync Engine
// ============================================================
// The orchestrator that ties everything together:
//   1. Local changes detected → add → commit → pull → push
//   2. Periodic timer → fetch → pull if behind
//
// It also manages sync state and prevents concurrent syncs
// (e.g., if a local sync is running when the periodic timer fires).
//
// 📘 TS LEARNING NOTES:
// - `enum` for state management
// - Mutex/lock pattern using a boolean flag
// - `setInterval` for periodic tasks
// - `async` orchestration — chaining multiple async steps
// ============================================================

import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { GitOperations } from "../git/GitOperations";
import { ConflictResolver } from "./ConflictResolver";
import { MergeStrategy } from "../settings";

// 📘 ENUM for sync states: Tracks what the engine is currently doing.
// The status bar reads this to show the right icon.
export enum SyncState {
	IDLE = "idle",
	PUSHING = "pushing",
	PULLING = "pulling",
	ERROR = "error",
	PAUSED = "paused",
}

// 📘 CALLBACK TYPE: The engine notifies the UI when state changes.
// This decouples the engine from the UI — the engine doesn't know
// about the status bar; it just calls this function.
type OnStateChange = (state: SyncState, message: string) => void;

export class SyncEngine {
	private readonly git: GitOperations;
	private readonly onStateChange: OnStateChange;
	private readonly pullIntervalMs: number;
	private readonly conflictResolver: ConflictResolver;
	private readonly vaultPath: string;

	// 📘 MUTEX: A simple boolean lock to prevent concurrent syncs.
	private syncing: boolean = false;

	// Timer for periodic remote checks
	private pullTimer: ReturnType<typeof setInterval> | null = null;

	// Track current state
	private state: SyncState = SyncState.IDLE;

	// Track last sync time
	private lastSyncTime: Date | null = null;

	constructor(
		git: GitOperations,
		pullIntervalMs: number,
		onStateChange: OnStateChange,
		mergeStrategy: MergeStrategy,
		deviceName: string,
		vaultPath: string,
	) {
		this.git = git;
		this.pullIntervalMs = pullIntervalMs;
		this.onStateChange = onStateChange;
		this.conflictResolver = new ConflictResolver(mergeStrategy, deviceName);
		this.vaultPath = vaultPath;
	}

	// -------------------------------------------------------
	// syncLocal() — Handle local file changes
	// -------------------------------------------------------
	// Called by the Debouncer when files have changed locally.
	// Flow: add changed files → commit → pull (rebase) → push
	async syncLocal(changedPaths: Set<string>): Promise<void> {
		// 📘 GUARD CLAUSE: Skip if already syncing or paused.
		// This is a common pattern — check preconditions at the top
		// and return early, keeping the main logic un-nested.
		if (this.syncing) {
			console.log("Obsync: Sync already in progress, skipping");
			return;
		}
		if (this.state === SyncState.PAUSED) {
			console.log("Obsync: Sync is paused, skipping");
			return;
		}

		this.syncing = true;

		try {
			// Auto-initialize git repo if it doesn't exist yet
			await this.git.ensureRepo();

			// Filter out any null/empty/invalid paths before processing
			const validPaths = Array.from(changedPaths).filter(
				(p) => p && typeof p === "string" && p.trim().length > 0
			);

			if (validPaths.length === 0) {
				console.log("Obsync: No valid file paths to sync");
				this.syncing = false;
				return;
			}

			// Stage all changed files
			for (const filepath of validPaths) {
				try {
					console.log(`Obsync: Staging file: "${filepath}"`);
					await this.git.add(filepath);
				} catch (addErr: unknown) {
					// File might have been deleted — try removing from git index
					const addMsg = addErr instanceof Error ? addErr.message : String(addErr);
					console.log(`Obsync: git add failed for "${filepath}" — ${addMsg}, trying remove`);
					try {
						await this.git.remove(filepath);
					} catch {
						console.log(`Obsync: Could not stage "${filepath}", skipping`);
					}
				}
			}

			// Commit
			// 📘 Build a human-readable commit message.
			// If 1-3 files changed, list them. Otherwise, show count.
			const fileList = validPaths.length <= 3
				? validPaths.join(", ")
				: `${validPaths.length} files`;
			const message = `sync: update ${fileList}`;
			console.log("Obsync: About to commit...");
			await this.git.commit(message);
			console.log("Obsync: Commit succeeded");

			// Pull remote changes first (to avoid push conflicts)
			this.setState(SyncState.PULLING, "Pulling remote changes...");
			const pullResult = await this.git.pull();

			if (pullResult.conflicts.length > 0) {
				// 📘 AUTO-RESOLVE CONFLICTS using the ConflictResolver.
				// 1. Find all files with conflict markers
				// 2. Resolve each one using the user's chosen strategy
				// 3. Stage the resolved files and commit
				const resolvedCount = await this.resolveConflicts();
				if (resolvedCount > 0) {
					new Notice(
						`Obsync: Auto-resolved ${resolvedCount} conflict(s)`,
						5000,
					);
				}
			}

			// Push our changes
			this.setState(SyncState.PUSHING, "Pushing changes...");
			await this.git.push();

			// Success!
			this.lastSyncTime = new Date();
			this.setState(SyncState.IDLE, this.getLastSyncMessage());
			console.log(`Obsync: Synced ${validPaths.length} file(s)`);

		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Obsync: Sync failed — ${msg}`);
			this.setState(SyncState.ERROR, `Sync failed: ${msg}`);
			new Notice(`Obsync: Sync failed — ${msg}`, 10000);
		} finally {
			// 📘 FINALLY: Always runs, whether try succeeded or catch ran.
			// Same as Java's finally block. We release the lock here so
			// the next sync can proceed.
			this.syncing = false;
		}
	}

	// -------------------------------------------------------
	// syncRemote() — Check for and pull remote changes
	// -------------------------------------------------------
	// Called periodically by the pull timer.
	async syncRemote(): Promise<void> {
		if (this.syncing || this.state === SyncState.PAUSED) {
			return;
		}

		this.syncing = true;

		try {
			await this.git.ensureRepo();
			this.setState(SyncState.PULLING, "Checking for remote changes...");
			const pullResult = await this.git.pull();

			if (pullResult.merged) {
				this.lastSyncTime = new Date();
				console.log("Obsync: Pulled remote changes");
			}

			if (pullResult.conflicts.length > 0) {
				const resolvedCount = await this.resolveConflicts();
				if (resolvedCount > 0) {
					// After resolving, push the resolved files
					await this.git.push();
					new Notice(
						`Obsync: Auto-resolved ${resolvedCount} conflict(s) from remote`,
						5000,
					);
				}
			}

			this.setState(SyncState.IDLE, this.getLastSyncMessage());

		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// Don't spam errors for network issues during periodic checks
			console.log(`Obsync: Remote check failed — ${msg}`);
			this.setState(SyncState.IDLE, this.getLastSyncMessage());
		} finally {
			this.syncing = false;
		}
	}

	// -------------------------------------------------------
	// startPeriodicSync() — Begin periodic remote checks
	// -------------------------------------------------------
	// 📘 setInterval: Like setTimeout but repeats every N ms.
	// Java equivalent: ScheduledExecutorService.scheduleAtFixedRate()
	startPeriodicSync(): void {
		// Don't start if no remote URL configured
		if (this.pullIntervalMs <= 0) return;

		this.stopPeriodicSync(); // Clear any existing timer

		this.pullTimer = setInterval(() => {
			// 📘 We call syncRemote() but don't await it here.
			// setInterval callbacks can't be async, so we let
			// the Promise run in the background. Errors are caught
			// inside syncRemote() itself.
			this.syncRemote();
		}, this.pullIntervalMs);

		console.log(`Obsync: Periodic sync started (every ${this.pullIntervalMs / 1000}s)`);
	}

	// -------------------------------------------------------
	// stopPeriodicSync() — Stop the periodic timer
	// -------------------------------------------------------
	stopPeriodicSync(): void {
		if (this.pullTimer !== null) {
			clearInterval(this.pullTimer);
			this.pullTimer = null;
		}
	}

	// -------------------------------------------------------
	// pause() / resume() — Toggle sync on/off
	// -------------------------------------------------------
	pause(): void {
		this.stopPeriodicSync();
		this.setState(SyncState.PAUSED, "Sync paused");
		console.log("Obsync: Sync paused");
	}

	resume(): void {
		this.setState(SyncState.IDLE, "Sync resumed");
		this.startPeriodicSync();
		console.log("Obsync: Sync resumed");
	}

	isPaused(): boolean {
		return this.state === SyncState.PAUSED;
	}

	// -------------------------------------------------------
	// cleanup() — Stop everything (called on plugin unload)
	// -------------------------------------------------------
	cleanup(): void {
		this.stopPeriodicSync();
	}

	// -------------------------------------------------------
	// resolveConflicts() — Find and auto-resolve conflicted files
	// -------------------------------------------------------
	// 📘 This method:
	// 1. Gets all files with changes from git status
	// 2. Reads each file and checks for conflict markers
	// 3. Resolves conflicts using the ConflictResolver
	// 4. Writes the resolved content back and stages for commit
	// 📘 TEXT FILE EXTENSIONS that we can safely scan for conflict markers.
	// Binary files (images, PDFs) should never be read as text.
	private static readonly TEXT_EXTENSIONS = new Set([
		".md", ".txt", ".css", ".js", ".ts", ".json", ".yaml", ".yml",
		".html", ".htm", ".xml", ".csv", ".svg", ".ini", ".cfg", ".conf",
		".tex", ".bib", ".org", ".rst",
	]);

	// Max file size (5MB) to prevent reading huge files into memory
	private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024;

	private isTextFile(filepath: string): boolean {
		const ext = path.extname(filepath).toLowerCase();
		// Files with no extension are treated as text (e.g., LICENSE, Makefile)
		return ext === "" || SyncEngine.TEXT_EXTENSIONS.has(ext);
	}

	private async resolveConflicts(): Promise<number> {
		let resolvedCount = 0;

		try {
			const statuses = await this.git.status();

			for (const file of statuses) {
				// Only check text files that might have conflict markers
				if (!this.isTextFile(file.filepath)) {
					continue;
				}

				const fullPath = path.join(this.vaultPath, file.filepath);

				try {
					// Check file exists and size is within limits
					if (!fs.existsSync(fullPath)) continue;

					const stat = fs.statSync(fullPath);
					if (stat.size > SyncEngine.MAX_FILE_SIZE) {
						console.log(`Obsync: Skipping conflict check for large file: ${file.filepath}`);
						continue;
					}

					// Read the file content
					const content = fs.readFileSync(fullPath, "utf-8");

					// Check for conflict markers and resolve
					const result = this.conflictResolver.resolve(content);

					if (result.hadConflicts) {
						// Write resolved content back to the file
						fs.writeFileSync(fullPath, result.resolvedContent, "utf-8");

						// Stage the resolved file
						await this.git.add(file.filepath);
						resolvedCount++;

						console.log(`Obsync: Resolved conflict in ${file.filepath}`);
					}
				} catch (fileErr: unknown) {
					// 📘 Per-file error handling: one bad file doesn't stop all resolutions
					const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
					console.error(`Obsync: Failed to resolve ${file.filepath} — ${msg}`);
				}
			}

			// If we resolved anything, commit the resolutions
			if (resolvedCount > 0) {
				await this.git.commit(
					`sync: auto-resolved ${resolvedCount} conflict(s)`
				);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Obsync: Conflict resolution failed — ${msg}`);
		}

		return resolvedCount;
	}

	// -------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------

	private setState(state: SyncState, message: string): void {
		this.state = state;
		this.onStateChange(state, message);
	}

	private getLastSyncMessage(): string {
		if (!this.lastSyncTime) {
			return "Obsync: Ready";
		}
		// 📘 toLocaleTimeString() formats a Date into a readable time string.
		// e.g., "2:30:45 PM"
		return `Obsync: Synced at ${this.lastSyncTime.toLocaleTimeString()}`;
	}
}
