// ============================================================
// Obsync — File Watcher
// ============================================================
// Listens to Obsidian's vault events (create, modify, delete, rename)
// and feeds them into the Debouncer. The Debouncer then triggers
// the sync after a quiet period.
//
// Why use Obsidian's vault events instead of Node.js fs.watch()?
// - Obsidian already watches the filesystem — no duplicate watchers
// - Vault events give us paths relative to the vault root (what git needs)
// - Vault events handle OS differences (macOS FSEvents vs Windows ReadDirectoryChanges)
//
// 📘 TS LEARNING NOTES:
// - Event listeners — subscribing to events with callbacks
// - `EventRef` — Obsidian's way of tracking event subscriptions
// - Array methods — .some() for pattern matching
// ============================================================

import { Vault, TAbstractFile, TFile, EventRef } from "obsidian";
import { Debouncer } from "./Debouncer";

export class FileWatcher {
	private readonly vault: Vault;
	private readonly debouncer: Debouncer;
	private readonly ignoredPatterns: string[];

	// 📘 EventRef[] — stores references to our event subscriptions.
	// We need these to unsubscribe when the plugin unloads.
	// In Java, this is like keeping references to listeners so you can
	// call removeListener() later.
	private eventRefs: EventRef[] = [];

	constructor(vault: Vault, debouncer: Debouncer, ignoredPatterns: string[]) {
		this.vault = vault;
		this.debouncer = debouncer;
		this.ignoredPatterns = ignoredPatterns;
	}

	// -------------------------------------------------------
	// start() — Begin watching for file changes
	// -------------------------------------------------------
	start(): void {
		// 📘 OBSIDIAN EVENTS:
		// `vault.on("event", callback)` registers an event listener.
		// It returns an EventRef we can use to unsubscribe later.

		// 📘 Obsidian vault events pass TAbstractFile (could be file or folder).
		// We only care about files (TFile), not folders (TFolder).
		// Guard against null/undefined file objects too.

		this.eventRefs.push(
			this.vault.on("modify", (file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.handleChange(file.path, "modified");
				}
			})
		);

		this.eventRefs.push(
			this.vault.on("create", (file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.handleChange(file.path, "created");
				}
			})
		);

		this.eventRefs.push(
			this.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile) {
					this.handleChange(file.path, "deleted");
				}
			})
		);

		this.eventRefs.push(
			this.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile) {
					this.handleChange(oldPath, "renamed-from");
					this.handleChange(file.path, "renamed-to");
				}
			})
		);

		console.log("Obsync: File watcher started");
	}

	// -------------------------------------------------------
	// stop() — Stop watching for file changes
	// -------------------------------------------------------
	stop(): void {
		// 📘 Unsubscribe from all events.
		// `vault.offref()` is Obsidian's way of removing an event listener.
		// forEach loops over every EventRef and unsubscribes it.
		this.eventRefs.forEach((ref) => {
			this.vault.offref(ref);
		});
		this.eventRefs = [];

		// Also cancel any pending debounce timer
		this.debouncer.cancel();

		console.log("Obsync: File watcher stopped");
	}

	// -------------------------------------------------------
	// handleChange() — Process a single file change event
	// -------------------------------------------------------
	private handleChange(filepath: string, eventType: string): void {
		// Skip empty or invalid paths
		if (!filepath || filepath.trim().length === 0) {
			return;
		}

		// Skip ignored files
		if (this.isIgnored(filepath)) {
			return;
		}

		// Skip the .git directory itself
		if (filepath.startsWith(".git/") || filepath === ".git") {
			return;
		}

		// Skip our own plugin data (prevents sync loop when settings are saved)
		if (filepath.startsWith(".obsidian/plugins/obsync/")) {
			return;
		}

		console.log(`Obsync: ${eventType} — ${filepath}`);

		// Feed into the debouncer — it will batch this with other
		// recent changes and fire after the quiet period.
		this.debouncer.notify(filepath);
	}

	// -------------------------------------------------------
	// isIgnored() — Check if a file matches any ignore pattern
	// -------------------------------------------------------
	// 📘 ARRAY .some() — returns true if ANY element passes the test.
	// It's like Java's Stream .anyMatch().
	// Example: ["workspace.json", ".DS_Store"].some(p => "workspace.json".includes(p))
	//          → true (first pattern matches)
	private isIgnored(filepath: string): boolean {
		return this.ignoredPatterns.some((pattern) => {
			// Simple substring matching — if the pattern appears
			// anywhere in the filepath, it's ignored.
			// e.g., pattern ".obsidian/workspace.json" matches
			//        filepath ".obsidian/workspace.json"
			return filepath.includes(pattern);
		});
	}
}
