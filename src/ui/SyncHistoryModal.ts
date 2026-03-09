// ============================================================
// Obsync — Sync History Modal
// ============================================================
// A popup dialog that shows recent git commit history.
// Opened via the command palette: "Obsync: View sync history"
//
// 📘 TS LEARNING NOTES:
// - Obsidian's `Modal` class — creating popup dialogs
// - DOM creation — building HTML elements programmatically
// - `async onOpen()` — loading data when the modal opens
// ============================================================

import { App, Modal } from "obsidian";
import { CommitLog } from "../git/GitOperations";

export class SyncHistoryModal extends Modal {
	// 📘 The modal receives commit logs to display.
	// We pass them in via the constructor rather than loading them here,
	// to keep the modal a "dumb" display component (separation of concerns).
	private readonly logs: CommitLog[];

	constructor(app: App, logs: CommitLog[]) {
		// 📘 `super(app)` — call the parent Modal constructor.
		super(app);
		this.logs = logs;
	}

	// 📘 onOpen(): Called by Obsidian when the modal is displayed.
	// We build the HTML content here.
	onOpen(): void {
		const { contentEl } = this;

		// 📘 DOM CREATION: `createEl()` is Obsidian's helper for creating elements.
		// It's shorthand for document.createElement() + setting attributes.
		contentEl.createEl("h2", { text: "Sync History" });

		if (this.logs.length === 0) {
			contentEl.createEl("p", {
				text: "No sync history yet. Changes will appear here after your first sync.",
				cls: "obsync-empty-state",
			});
			return;
		}

		// 📘 Create a container div for the log entries.
		const listEl = contentEl.createEl("div", { cls: "obsync-history-list" });

		// 📘 forEach: Loop over each log entry and create HTML for it.
		this.logs.forEach((log) => {
			// Each entry is a div with commit info
			const entryEl = listEl.createEl("div", {
				cls: "obsync-history-entry",
			});

			// 📘 Style the entry with inline CSS.
			// In a production plugin, you'd use a styles.css file instead.
			entryEl.style.padding = "8px 0";
			entryEl.style.borderBottom = "1px solid var(--background-modifier-border)";

			// Header row: SHA + date
			const headerEl = entryEl.createEl("div", {
				cls: "obsync-history-header",
			});
			headerEl.style.display = "flex";
			headerEl.style.justifyContent = "space-between";
			headerEl.style.marginBottom = "4px";

			// 📘 `createEl("code", ...)` creates a <code> element for monospace text.
			headerEl.createEl("code", {
				text: log.sha,
				cls: "obsync-sha",
			});

			headerEl.createEl("span", {
				text: log.date.toLocaleString(),
				cls: "obsync-date",
			});

			// Commit message
			entryEl.createEl("div", {
				text: log.message,
				cls: "obsync-message",
			});

			// Author
			const authorEl = entryEl.createEl("small", {
				text: `by ${log.author}`,
				cls: "obsync-author",
			});
			authorEl.style.color = "var(--text-muted)";
		});
	}

	// 📘 onClose(): Called when the modal is dismissed (Escape or clicking outside).
	// Clean up the content to prevent memory leaks.
	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
