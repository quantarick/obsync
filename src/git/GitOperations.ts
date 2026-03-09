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
import { execFile } from "child_process";
import { promisify } from "util";

// 📘 promisify: Converts a callback-based function into one that returns a Promise.
// execFile runs a system command. We use the system `git` CLI for operations that
// isomorphic-git can't handle (e.g., Unicode filenames on macOS).
const execFileAsync = promisify(execFile);

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

	constructor(dir: string, remoteUrl: string, token: string, authorName: string, authorEmail: string) {
		this.dir = dir;
		this.remoteUrl = remoteUrl;
		this.token = token;
		this.authorName = authorName;
		this.authorEmail = authorEmail || `${authorName}@obsync`;
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
		await this.execGit([
			"-c", `user.name=${this.authorName}`,
			"-c", `user.email=${this.authorEmail}`,
			"commit", "-m", message,
		]);
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
	// pull() — Fetch and merge remote changes
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
			// Fetch the latest from remote
			await git.fetch({
				fs,
				http,
				dir: this.dir,
				remote: "origin",
				onAuth: () => ({
					username: this.token,
				}),
			});

			// Get current branch
			const branch = await git.currentBranch({
				fs,
				dir: this.dir,
				fullname: false,
			});

			if (!branch) {
				console.log("Obsync: No current branch found, skipping pull");
				return { merged: false, conflicts: [] };
			}

			// Check if remote branch exists
			try {
				await git.resolveRef({
					fs,
					dir: this.dir,
					ref: `refs/remotes/origin/${branch}`,
				});
			} catch {
				console.log("Obsync: Remote branch not found, nothing to pull");
				return { merged: false, conflicts: [] };
			}

			// Try to merge remote changes
			try {
				await git.merge({
					fs,
					dir: this.dir,
					theirs: `origin/${branch}`,
					author: {
						name: this.authorName,
						email: this.authorEmail,
					},
				});
				// After merge, checkout to update working directory
				await git.checkout({ fs, dir: this.dir, ref: branch });
				console.log("Obsync: Pulled and merged remote changes");
				return { merged: true, conflicts: [] };
			} catch (mergeError: unknown) {
				const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);
				console.log(`Obsync: Merge issue — ${msg}`);
				return { merged: false, conflicts: [msg] };
			}
		} catch (fetchError: unknown) {
			const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
			console.error(`Obsync: Pull failed — ${msg}`);
			throw fetchError;
		}
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
	private async execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
		console.log(`Obsync: execGit cwd="${this.dir}" args=${JSON.stringify(args)}`);
		try {
			const result = await execFileAsync("git", args, {
				cwd: this.dir,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				timeout: 30000,
			});
			return result;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Obsync: execGit failed — ${msg}`);
			throw err;
		}
	}
}
