// ============================================================
// Obsync — Vault Restructure Preview Modal
// ============================================================
// Shows the AI-proposed restructuring plan with checkboxes.
// User can toggle individual operations, then apply or cancel.
// During execution, shows progress updates.
// ============================================================

import { App, Modal } from "obsidian";
import {
	VaultPlan,
	PlanOperation,
	PlanOperationType,
} from "../ai/VaultRestructurePlan";

type OnApply = (selectedOps: PlanOperation[]) => Promise<void>;

export class VaultRestructureModal extends Modal {
	private readonly plan: VaultPlan;
	private readonly onApply: OnApply;
	private selected: Set<number>; // indices of selected operations
	private executing: boolean = false;

	constructor(app: App, plan: VaultPlan, onApply: OnApply) {
		super(app);
		this.plan = plan;
		this.onApply = onApply;
		// All operations selected by default
		this.selected = new Set(plan.operations.map((_, i) => i));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		this.modalEl.style.width = "90vw";
		this.modalEl.style.maxWidth = "900px";

		this.renderPlan();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderPlan(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		contentEl.createEl("h2", { text: "Vault Restructuring Plan" });

		// Summary
		const summaryEl = contentEl.createEl("div", {
			attr: {
				style:
					"background: var(--background-secondary); padding: 12px; " +
					"border-radius: 6px; margin-bottom: 16px; font-size: 13px; line-height: 1.5;",
			},
		});
		summaryEl.textContent = this.plan.summary;

		// Stats
		const stats = this.getStats();
		const statsEl = contentEl.createEl("div", {
			attr: { style: "color: var(--text-muted); font-size: 12px; margin-bottom: 12px;" },
		});
		statsEl.textContent =
			`${stats.folders} folder(s), ${stats.moves} move(s), ${stats.merges} merge(s), ` +
			`${stats.splits} split(s), ${stats.renames} rename(s) — ${this.selected.size} of ${this.plan.operations.length} selected`;

		// Select all / none
		const selectRow = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 8px; display: flex; gap: 8px;" },
		});
		const selectAllBtn = selectRow.createEl("button", { text: "Select all", cls: "mod-muted" });
		selectAllBtn.style.fontSize = "11px";
		selectAllBtn.addEventListener("click", () => {
			this.selected = new Set(this.plan.operations.map((_, i) => i));
			this.renderPlan();
		});
		const selectNoneBtn = selectRow.createEl("button", { text: "Select none", cls: "mod-muted" });
		selectNoneBtn.style.fontSize = "11px";
		selectNoneBtn.addEventListener("click", () => {
			this.selected.clear();
			this.renderPlan();
		});

		// Operations list
		const listEl = contentEl.createEl("div", {
			attr: {
				style: "max-height: 55vh; overflow-y: auto; border: 1px solid var(--background-modifier-border); " +
					"border-radius: 4px; padding: 8px;",
			},
		});

		// Group by type
		const groups: [string, PlanOperationType, string][] = [
			["New Folders", PlanOperationType.CREATE_FOLDER, "folder"],
			["Merge Notes", PlanOperationType.MERGE, "git-merge"],
			["Split Notes", PlanOperationType.SPLIT, "scissors"],
			["Move Notes", PlanOperationType.MOVE, "arrow-right"],
			["Rename Notes", PlanOperationType.RENAME, "pencil"],
		];

		for (const [groupName, type, _icon] of groups) {
			const ops = this.plan.operations
				.map((op, i) => ({ op, index: i }))
				.filter(({ op }) => op.type === type);

			if (ops.length === 0) continue;

			listEl.createEl("h4", {
				text: `${groupName} (${ops.length})`,
				attr: { style: "margin: 12px 0 6px 0; font-size: 13px;" },
			});

			for (const { op, index } of ops) {
				this.renderOperation(listEl, op, index);
			}
		}

		// Button row
		const buttonRow = contentEl.createEl("div", {
			attr: {
				style: "display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; align-items: center;",
			},
		});

		buttonRow.createEl("span", {
			text: "Merge/split operations require additional AI calls",
			attr: { style: "color: var(--text-muted); font-size: 11px; margin-right: auto;" },
		});

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const applyBtn = buttonRow.createEl("button", {
			text: `Apply ${this.selected.size} operation(s)`,
			cls: "mod-cta",
		});
		applyBtn.disabled = this.selected.size === 0;
		applyBtn.addEventListener("click", () => this.handleApply());
	}

	private renderOperation(container: HTMLElement, op: PlanOperation, index: number): void {
		const row = container.createEl("label", {
			attr: {
				style:
					"display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px; " +
					"cursor: pointer; border-bottom: 1px solid var(--background-modifier-border);",
			},
		});

		const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
		checkbox.checked = this.selected.has(index);
		checkbox.style.marginTop = "3px";
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) {
				this.selected.add(index);
			} else {
				this.selected.delete(index);
			}
			// Don't re-render the whole thing, just update stats and button
		});

		const detailEl = row.createEl("div", { attr: { style: "flex: 1; min-width: 0;" } });

		// Operation description
		const descEl = detailEl.createEl("div", { attr: { style: "font-size: 13px;" } });
		descEl.innerHTML = this.formatOperation(op);

		// Reason
		if (this.getOperationReason(op)) {
			detailEl.createEl("div", {
				text: this.getOperationReason(op),
				attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 2px;" },
			});
		}
	}

	private formatOperation(op: PlanOperation): string {
		// Using textContent would be safer but we need the arrow styling
		const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

		switch (op.type) {
			case PlanOperationType.CREATE_FOLDER:
				return `<strong>${esc(op.path)}</strong>`;
			case PlanOperationType.MOVE:
				return `${esc(op.source)} <span style="color:var(--text-muted)">→</span> <strong>${esc(op.destination)}</strong>`;
			case PlanOperationType.RENAME:
				return `${esc(op.source)} <span style="color:var(--text-muted)">→</span> <strong>${esc(op.destination)}</strong>`;
			case PlanOperationType.MERGE:
				return `${op.sources.map(esc).join(" + ")} <span style="color:var(--text-muted)">→</span> <strong>${esc(op.destination)}</strong>`;
			case PlanOperationType.SPLIT:
				return `${esc(op.source)} <span style="color:var(--text-muted)">→</span> <strong>${op.destinations.map(esc).join(", ")}</strong>`;
			default:
				return "Unknown operation";
		}
	}

	private getOperationReason(op: PlanOperation): string {
		return op.reason || "";
	}

	private getStats() {
		const ops = this.plan.operations;
		return {
			folders: ops.filter((o) => o.type === PlanOperationType.CREATE_FOLDER).length,
			moves: ops.filter((o) => o.type === PlanOperationType.MOVE).length,
			merges: ops.filter((o) => o.type === PlanOperationType.MERGE).length,
			splits: ops.filter((o) => o.type === PlanOperationType.SPLIT).length,
			renames: ops.filter((o) => o.type === PlanOperationType.RENAME).length,
		};
	}

	private async handleApply(): Promise<void> {
		if (this.executing) return;
		this.executing = true;

		const selectedOps = this.plan.operations.filter((_, i) => this.selected.has(i));

		// Switch to progress view
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Applying Changes..." });

		const progressEl = contentEl.createEl("div", {
			attr: {
				style: "max-height: 60vh; overflow-y: auto; padding: 8px; font-family: var(--font-monospace); " +
					"font-size: 12px; background: var(--background-secondary); border-radius: 4px;",
			},
		});

		try {
			await this.onApply(selectedOps);

			progressEl.createEl("div", {
				text: "Done!",
				attr: { style: "color: var(--text-success); font-weight: bold; margin-top: 8px;" },
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			progressEl.createEl("div", {
				text: `Error: ${msg}`,
				attr: { style: "color: var(--text-error); margin-top: 8px;" },
			});
		}

		// Close button
		const btnRow = contentEl.createEl("div", {
			attr: { style: "display: flex; justify-content: flex-end; margin-top: 16px;" },
		});
		const closeBtn = btnRow.createEl("button", { text: "Close", cls: "mod-cta" });
		closeBtn.addEventListener("click", () => this.close());
	}
}
