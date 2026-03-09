// ============================================================
// Obsync — Git Operations
// ============================================================
// Wraps isomorphic-git into a clean, high-level API.
// Each method handles one git operation (init, add, commit, etc.)
//
// 📘 TS LEARNING NOTES:
// - `async/await` — how we handle asynchronous operations
// - `try/catch` — error handling (same as Java)
// - `Promise<T>` — a value that will be available in the future
// ============================================================

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

// 📘 promisify: Converts a callback-based function into one that returns a Promise.
// execFile runs a system command. We use the system `git` CLI for operations that
// isomorphic-git can't handle (e.g., Unicode filenames on macOS).
const execFileAsync = promisify(execFile);

// 📘 INTERFACE: Options for execGit() to control error handling.
// `allowedExitCodes` lets callers treat certain non-zero exits as non-errors
// (e.g., exit code 1 from `git merge` means conflicts).
interface ExecGitOptions {
	allowedExitCodes?: number[];
}

// 📘 INTERFACE: Result from execGit(), includes exit code for allowed non-zero exits.
interface ExecGitResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

// 📘 INTERFACE: Defines the shape of a "file status" result.
// Each field has a type annotation after the colon.
export interface FileStatus {
	filepath: string;
	status: string; // "modified", "added", "deleted", etc.
}

// 📘 INTERFACE: Defines the shape of a commit log entry.
export interface CommitLog {
	sha: string;
	message: string;
	author: string;
	date: Date;
}

// 📘 CLASS: Encapsulates all git operations.
// The constructor takes config values and stores them as private fields.
export class GitOperations {
	// 📘 PRIVATE FIELDS: Only accessible within this class.
	// `readonly` means they can't be changed after construction (like Java's `final`).
	private readonly dir: string;
	private readonly remoteUrl: string;
	private readonly token: string;
	private readonly authorName: string;
	private readonly authorEmail: string;
	private readonly branch: string;

	constructor(dir: string, remoteUrl: string, token: string, authorName: string, authorEmail: string, branch: string) {
		this.dir = dir;
		this.remoteUrl = remoteUrl;
		this.token = token;
		this.authorName = authorName;
		this.authorEmail = authorEmail || `${authorName}@obsync`;
		this.branch = branch || "main";
	}

	// -------------------------------------------------------
	// init() — Initialize a git repo in the vault folder
	// -------------------------------------------------------
	async init(): Promise<void> {
		console.log(`Obsync: Initializing git repo at "${this.dir}"`);
		await this.execGit(["init"]);
		console.log(`Obsync: Git repo initialized at ${this.dir}`);
	}

	// -------------------------------------------------------
	// isRepo() — Check if the vault is already a git repo
	// -------------------------------------------------------
	async isRepo(): Promise<boolean> {
		// 📘 Use system git to check — ensures consistency with add/commit.
		try {
			const { stdout } = await this.execGit(["rev-parse", "--is-inside-work-tree"]);
			return stdout.trim() === "true";
		} catch {
			return false;
		}
	}

	// -------------------------------------------------------
	// hasCommits() — Check if the repo has any commits yet
	// -------------------------------------------------------
	async hasCommits(): Promise<boolean> {
		try {
			await this.execGit(["rev-parse", "HEAD"]);
			return true;
		} catch {
			return false;
		}
	}

	// -------------------------------------------------------
	// add() — Stage a file for commit
	// -------------------------------------------------------
	async add(filepath: string): Promise<void> {
		if (!filepath || typeof filepath !== "string") {
			throw new Error(`Invalid filepath: ${filepath}`);
		}
		// 📘 Use system git for add to avoid isomorphic-git's Unicode bug on macOS.
		await this.execGit(["add", "--", filepath]);
	}

	// -------------------------------------------------------
	// remove() — Stage a file deletion
	// -------------------------------------------------------
	async remove(filepath: string): Promise<void> {
		await this.execGit(["rm", "--cached", "--", filepath]);
	}

	// -------------------------------------------------------
	// commit() — Create a commit with staged changes
	// -------------------------------------------------------
	async commit(message: string): Promise<string> {
		// 📘 Use system git for commit to avoid isomorphic-git's Unicode tree bug.
		// Allow exit code 1 — git returns 1 when there's nothing to commit.
		const result = await this.execGit(
			[
				"-c", `user.name=${this.authorName}`,
				"-c", `user.email=${this.authorEmail}`,
				"commit", "-m", message,
			],
			{ allowedExitCodes: [1] },
		);
		if (result.exitCode === 1) {
			console.log("Obsync: Nothing to commit, working tree clean");
			const { stdout } = await this.execGit(["rev-parse", "--short", "HEAD"]);
			return stdout.trim();
		}
		const { stdout } = await this.execGit(["rev-parse", "--short", "HEAD"]);
		const sha = stdout.trim();
		console.log(`Obsync: Committed ${sha} — ${message}`);
		return sha;
	}

	// -------------------------------------------------------
	// push() — Push commits to remote
	// -------------------------------------------------------
	async push(): Promise<void> {
		if (!(await this.hasCommits())) {
			console.log("Obsync: No commits yet, skipping push");
			return;
		}
		if (!this.remoteUrl) {
			console.log("Obsync: No remote URL configured, skipping push");
			return;
		}
		await git.push({
			fs,
			http,
			dir: this.dir,
			remote: "origin",
			// 📘 AUTHENTICATION: isomorphic-git uses an onAuth callback.
			onAuth: () => ({
				username: this.token,
			}),
		});
		console.log("Obsync: Pushed to remote");
	}

	// -------------------------------------------------------
	// pull() — Fetch and merge remote changes (pure isomorphic-git)
	// -------------------------------------------------------
	async pull(): Promise<{ merged: boolean; conflicts: string[] }> {
		if (!(await this.hasCommits())) {
			console.log("Obsync: No commits yet, skipping pull");
			return { merged: false, conflicts: [] };
		}
		if (!this.remoteUrl) {
			console.log("Obsync: No remote URL configured, skipping pull");
			return { merged: false, conflicts: [] };
		}

		try {
			// Fetch the latest from remote (isomorphic-git handles token auth)
			await git.fetch({
				fs,
				http,
				dir: this.dir,
				remote: "origin",
				onAuth: () => ({
					username: this.token,
				}),
			});

			// Check if remote branch exists using isomorphic-git
			let remoteOid: string;
			try {
				remoteOid = await git.resolveRef({
					fs,
					dir: this.dir,
					ref: `refs/remotes/origin/${this.branch}`,
				});
			} catch {
				console.log("Obsync: Remote branch not found, nothing to pull");
				return { merged: false, conflicts: [] };
			}

			// Get local HEAD OID
			const headOid = await git.resolveRef({ fs, dir: this.dir, ref: "HEAD" });

			// Already up to date?
			if (headOid === remoteOid) {
				console.log("Obsync: Already up to date");
				return { merged: false, conflicts: [] };
			}

			// Try isomorphic-git merge
			try {
				await git.merge({
					fs,
					dir: this.dir,
					ours: this.branch,
					theirs: `remotes/origin/${this.branch}`,
					author: { name: this.authorName, email: this.authorEmail },
				});
				await git.checkout({ fs, dir: this.dir, ref: this.branch });
				console.log("Obsync: Pulled and merged remote changes");
				return { merged: true, conflicts: [] };
			} catch (mergeErr) {
				console.log("Obsync: isomorphic-git merge failed, attempting manual merge");
				return await this.manualMerge(headOid, remoteOid);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Obsync: Pull failed — ${msg}`);
			throw err;
		}
	}

	// -------------------------------------------------------
	// manualMerge() — Three-way merge when isomorphic-git merge fails
	// -------------------------------------------------------
	private async manualMerge(
		headOid: string,
		remoteOid: string,
	): Promise<{ merged: boolean; conflicts: string[] }> {
		// Find common ancestor (may be empty for unrelated histories)
		let baseOid: string | undefined;
		try {
			const bases = await git.findMergeBase({ fs, dir: this.dir, oids: [headOid, remoteOid] });
			baseOid = bases[0];
		} catch {
			baseOid = undefined;
		}

		// Build filepath → blobOid maps for base, local, and remote
		const baseMap = baseOid ? await this.getTreeMap(baseOid) : new Map<string, string>();
		const localMap = await this.getTreeMap(headOid);
		const remoteMap = await this.getTreeMap(remoteOid);

		// Collect all file paths across all three trees
		const allPaths = new Set<string>();
		for (const p of baseMap.keys()) allPaths.add(p);
		for (const p of localMap.keys()) allPaths.add(p);
		for (const p of remoteMap.keys()) allPaths.add(p);

		const conflicts: string[] = [];
		const changedFiles: string[] = [];
		const deletedFiles: string[] = [];

		for (const filepath of allPaths) {
			const baseBlob = baseMap.get(filepath);
			const localBlob = localMap.get(filepath);
			const remoteBlob = remoteMap.get(filepath);

			// Same on both sides → skip
			if (localBlob === remoteBlob) continue;

			// Only changed remotely (local same as base)
			if (localBlob === baseBlob && remoteBlob !== baseBlob) {
				if (remoteBlob) {
					await this.writeBlobToFile(filepath, remoteBlob);
					changedFiles.push(filepath);
				} else {
					// Remote deleted the file
					const fullPath = path.join(this.dir, filepath);
					if (fs.existsSync(fullPath)) {
						fs.unlinkSync(fullPath);
						deletedFiles.push(filepath);
					}
				}
				continue;
			}

			// Only changed locally (remote same as base) → keep as-is
			if (remoteBlob === baseBlob && localBlob !== baseBlob) {
				continue;
			}

			// Both changed differently
			if (localBlob && remoteBlob) {
				// Both modified → write conflict markers
				await this.writeConflictMarkers(filepath, localBlob, remoteBlob);
				conflicts.push(filepath);
			} else {
				// Deleted one side + changed other → conflict
				conflicts.push(filepath);
			}
		}

		// Write MERGE_HEAD so system git commit creates a merge commit
		const mergeHeadPath = path.join(this.dir, ".git", "MERGE_HEAD");
		fs.writeFileSync(mergeHeadPath, remoteOid + "\n");

		if (conflicts.length === 0) {
			// Stage all changed/deleted files and commit the merge
			for (const filepath of changedFiles) {
				await this.add(filepath);
			}
			for (const filepath of deletedFiles) {
				await this.remove(filepath);
			}
			await this.commit(`Merge remote branch 'origin/${this.branch}'`);
			// Clean up MERGE_HEAD if commit didn't remove it
			if (fs.existsSync(mergeHeadPath)) {
				fs.unlinkSync(mergeHeadPath);
			}
			console.log("Obsync: Manual merge completed successfully");
			return { merged: true, conflicts: [] };
		}

		console.log(`Obsync: ${conflicts.length} conflicted file(s): ${conflicts.join(", ")}`);
		return { merged: false, conflicts };
	}

	// -------------------------------------------------------
	// getTreeMap() — Walk a commit tree, return filepath → blobOid map
	// -------------------------------------------------------
	private async getTreeMap(commitOid: string): Promise<Map<string, string>> {
		const fileMap = new Map<string, string>();
		await git.walk({
			fs,
			dir: this.dir,
			trees: [git.TREE({ ref: commitOid })],
			map: async (filepath, [entry]) => {
				if (filepath === "." || !entry) return undefined;
				const type = await entry.type();
				if (type === "blob") {
					const oid = await entry.oid();
					if (oid) fileMap.set(filepath, oid);
				}
				return undefined;
			},
		});
		return fileMap;
	}

	// -------------------------------------------------------
	// writeBlobToFile() — Read a blob and write it to working directory
	// -------------------------------------------------------
	private async writeBlobToFile(filepath: string, blobOid: string): Promise<void> {
		const { blob } = await git.readBlob({ fs, dir: this.dir, oid: blobOid });
		const fullPath = path.join(this.dir, filepath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, Buffer.from(blob));
	}

	// -------------------------------------------------------
	// writeConflictMarkers() — Write a file with conflict markers
	// -------------------------------------------------------
	private async writeConflictMarkers(filepath: string, localOid: string, remoteOid: string): Promise<void> {
		const { blob: localBlob } = await git.readBlob({ fs, dir: this.dir, oid: localOid });
		const { blob: remoteBlob } = await git.readBlob({ fs, dir: this.dir, oid: remoteOid });
		const localContent = Buffer.from(localBlob).toString("utf8");
		const remoteContent = Buffer.from(remoteBlob).toString("utf8");
		const conflicted = `<<<<<<< LOCAL\n${localContent}\n=======\n${remoteContent}\n>>>>>>> REMOTE\n`;
		const fullPath = path.join(this.dir, filepath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, conflicted);
	}

	// -------------------------------------------------------
	// status() — Get list of changed files
	// -------------------------------------------------------
	async status(): Promise<FileStatus[]> {
		const matrix = await git.statusMatrix({
			fs,
			dir: this.dir,
			filter: (f: string) => !f.startsWith(".git/") && f !== ".git",
		});

		const results: FileStatus[] = [];
		for (const row of matrix) {
			const filepath = row[0];
			const head = row[1];
			const workdir = row[2];
			const stage = row[3];

			if (!filepath || typeof filepath !== "string") continue;
			if (head === 1 && workdir === 1 && stage === 1) continue;

			let status: string;
			if (head === 0 && workdir === 2) status = "added";
			else if (head === 1 && workdir === 0) status = "deleted";
			else if (head === 1 && workdir === 2) status = "modified";
			else status = "unknown";

			results.push({ filepath, status });
		}
		return results;
	}

	// -------------------------------------------------------
	// log() — Get recent commit history
	// -------------------------------------------------------
	async log(depth: number = 10): Promise<CommitLog[]> {
		try {
			const logs = await git.log({ fs, dir: this.dir, depth });

			return logs.map((entry) => ({
				sha: entry.oid.slice(0, 7),
				message: entry.commit.message.trim(),
				author: entry.commit.author.name,
				date: new Date(entry.commit.author.timestamp * 1000),
			}));
		} catch {
			return [];
		}
	}

	// -------------------------------------------------------
	// addRemote() — Set up the remote origin
	// -------------------------------------------------------
	async addRemote(): Promise<void> {
		try {
			await git.addRemote({
				fs,
				dir: this.dir,
				remote: "origin",
				url: this.remoteUrl,
			});
			console.log(`Obsync: Remote added — ${this.remoteUrl}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("already exists")) {
				throw err;
			}
		}
	}

	// -------------------------------------------------------
	// ensureRepo() — Initialize repo + remote if needed
	// -------------------------------------------------------
	async ensureRepo(): Promise<void> {
		console.log(`Obsync: ensureRepo() — checking if repo exists at "${this.dir}"`);
		const isExisting = await this.isRepo();
		console.log(`Obsync: ensureRepo() — isRepo=${isExisting}`);
		if (!isExisting) {
			await this.init();
		}
		if (this.remoteUrl) {
			await this.addRemote();
		}
	}

	// -------------------------------------------------------
	// execGit() — Run a system git command
	// -------------------------------------------------------
	private async execGit(args: string[], options?: ExecGitOptions): Promise<ExecGitResult> {
		console.log(`Obsync: execGit cwd="${this.dir}" args=${JSON.stringify(args)}`);
		try {
			const result = await execFileAsync("git", args, {
				cwd: this.dir,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				timeout: 30000,
			});
			return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
		} catch (err: unknown) {
			// Check if the exit code is in the allowed list
			const exitCode = (err as { code?: number }).code;
			if (typeof exitCode === "number" && options?.allowedExitCodes?.includes(exitCode)) {
				const stdout = (err as { stdout?: string }).stdout ?? "";
				const stderr = (err as { stderr?: string }).stderr ?? "";
				return { stdout, stderr, exitCode };
			}
			const stderr = (err as { stderr?: string }).stderr ?? "";
			const msg = stderr.trim() || (err instanceof Error ? err.message : String(err));
			console.error(`Obsync: execGit failed — ${msg}`);
			throw new Error(msg);
		}
	}
}
