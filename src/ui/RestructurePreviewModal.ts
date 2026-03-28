// ============================================================
// Obsync — Restructure Preview Modal
// ============================================================
// Shows a side-by-side view of the original and restructured note.
// User can accept (replace content) or cancel.
// ============================================================

import { App, Modal } from "obsidian";
import type { RestructureResult } from "../ai/RestructureService";

export class RestructurePreviewModal extends Modal {
	private readonly result: RestructureResult;
	private readonly onAccept: () => void;

	constructor(app: App, result: RestructureResult, onAccept: () => void) {
		super(app);
		this.result = result;
		this.onAccept = onAccept;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Make modal wider for side-by-side view
		this.modalEl.style.width = "90vw";
		this.modalEl.style.maxWidth = "1200px";

		// Header
		contentEl.createEl("h2", { text: "AI Restructured Note" });

		// Token info
		const infoEl = contentEl.createEl("div", {
			attr: { style: "color: var(--text-muted); font-size: 12px; margin-bottom: 12px;" },
		});
		infoEl.textContent =
			`Model: ${this.result.model} | ` +
			`Input: ${this.result.inputTokens.toLocaleString()} tokens | ` +
			`Output: ${this.result.outputTokens.toLocaleString()} tokens`;

		// Truncation warning
		if (this.result.truncated) {
			const warnEl = contentEl.createEl("div", {
				attr: {
					style:
						"background: var(--background-modifier-error); " +
						"color: var(--text-on-accent); " +
						"padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 13px;",
				},
			});
			warnEl.textContent =
				"Output was truncated due to length limits. Consider restructuring a smaller selection.";
		}

		// Side-by-side container
		const columnsEl = contentEl.createEl("div", {
			attr: {
				style:
					"display: flex; gap: 16px; margin-bottom: 16px;",
			},
		});

		// Column styles
		const columnStyle =
			"flex: 1; min-width: 0; display: flex; flex-direction: column;";
		const contentStyle =
			"flex: 1; overflow: auto; max-height: 60vh; " +
			"padding: 12px; border: 1px solid var(--background-modifier-border); " +
			"border-radius: 4px; font-family: var(--font-monospace); " +
			"font-size: 12px; white-space: pre-wrap; word-wrap: break-word; " +
			"background: var(--background-primary);";

		// Original column
		const leftCol = columnsEl.createEl("div", { attr: { style: columnStyle } });
		leftCol.createEl("h4", { text: "Original", attr: { style: "margin: 0 0 8px 0;" } });
		const leftContent = leftCol.createEl("div", { attr: { style: contentStyle } });
		leftContent.textContent = this.result.original;

		// Restructured column
		const rightCol = columnsEl.createEl("div", { attr: { style: columnStyle } });
		rightCol.createEl("h4", { text: "Restructured", attr: { style: "margin: 0 0 8px 0;" } });
		const rightContent = rightCol.createEl("div", { attr: { style: contentStyle } });
		rightContent.textContent = this.result.restructured;

		// Button row
		const buttonRow = contentEl.createEl("div", {
			attr: {
				style: "display: flex; justify-content: flex-end; gap: 8px; align-items: center;",
			},
		});

		// Undo hint
		buttonRow.createEl("span", {
			text: "You can undo with Ctrl/Cmd+Z after accepting",
			attr: { style: "color: var(--text-muted); font-size: 11px; margin-right: auto;" },
		});

		// Cancel button
		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		// Accept button
		const acceptBtn = buttonRow.createEl("button", {
			text: "Accept",
			cls: "mod-cta",
		});
		acceptBtn.addEventListener("click", () => {
			this.onAccept();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
