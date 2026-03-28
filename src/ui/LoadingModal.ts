// ============================================================
// Obsync — Loading Modal
// ============================================================
// Simple modal shown during long-running operations (e.g., API calls).
// Blocks user interaction and is dismissed programmatically.
// ============================================================

import { App, Modal } from "obsidian";

export class LoadingModal extends Modal {
	private readonly message: string;

	constructor(app: App, message: string) {
		super(app);
		this.message = message;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("div", {
			text: this.message,
			attr: { style: "text-align: center; padding: 24px 16px; font-size: 15px;" },
		});

		// Simple animated dots
		const dotsEl = contentEl.createEl("div", {
			attr: { style: "text-align: center; font-size: 24px; letter-spacing: 4px;" },
		});
		dotsEl.textContent = "...";

		// CSS animation for the dots
		const style = contentEl.createEl("style");
		style.textContent = `
			@keyframes obsync-pulse {
				0%, 100% { opacity: 0.3; }
				50% { opacity: 1; }
			}
			.obsync-loading-dots {
				animation: obsync-pulse 1.5s ease-in-out infinite;
			}
		`;
		dotsEl.addClass("obsync-loading-dots");
	}

	onClose(): void {
		this.contentEl.empty();
	}

	dismiss(): void {
		this.close();
	}
}
